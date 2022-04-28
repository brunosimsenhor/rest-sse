import os
import sys
import json
import time
import uuid
import queue
import base64
import datetime
import threading

# flask
from flask import Flask, request, Response, abort, jsonify
from flask_cors import CORS

# cryptography
from cryptography.hazmat.primitives.serialization import load_ssh_public_key
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes

app = Flask(__name__)
CORS(app)

@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Headers', 'Content-type,X-Signature,X-User-ID')
    return response

import pymongo
from pymongo import MongoClient

# hostname = os.getenv('HOSTNAME')
db_uri = os.getenv('DB_URI')
client = MongoClient(db_uri)

#####
class DB(object):
    def __init__(self, db):
        self.client_collection = db.clients
        self.survey_collection = db.surveys
        self.votes_collection = db.votes

    # persists a client
    def persist_client(self, name: str, public_key: str):
        data = {
            '_id': str(uuid.uuid4()),
            'name': name,
            'public_key': public_key,
            'logged': True,
        }

        self.client_collection.insert_one(data)

        return data

    # persists a survey
    def persist_survey(self, title: str, client_id: str, local: str, due_date: datetime, options: list[str]):
        survey_id = str(uuid.uuid4())

        data = {
            '_id': survey_id,
            'title': title,
            'createdBy': client_id,
            'local': local,
            'dueDate': datetime.datetime.fromisoformat(due_date),
            'closed': False,
            'options': options,
        }

        self.survey_collection.insert_one(data)

        return data

    def close_survey(self, survey_id: str) -> bool:
        self.survey_collection.update_one({ '_id': survey_id }, { '$set': { 'closed': True }})

        return True

    # tries to persists a vote, if the client didn't vote that survey
    def persist_vote(self, client_id: str, survey_id: str, option: str):
        if self.votes_collection.count_documents({ 'client_id': client_id, 'survey_id': survey_id }) == 0:
            self.votes_collection.insert_one({ 'client_id': client_id, 'survey_id': survey_id, 'option': str(option) })

            return True

        return False

    # checks if the survey was voted by all clients
    def check_survey(self, survey):
        if self.votes_collection.count_documents({ 'survey_id': survey['_id'] }) >= 3:
            return True

        return False

    def find_client(self, client_id):
        return self.client_collection.find_one({ '_id': client_id })

    def list_logged_clients(self):
        return self.client_collection.find({ 'logged': True })

    def find_survey(self, survey_id):
        return self.survey_collection.find_one({ '_id': survey_id })

    def list_surveys(self):
        return self.survey_collection.find()

    def close_survey(self, survey_id: str) -> bool:
        self.survey_collection.update_one({ '_id': survey_id }, { '$set': { 'closed': True }})

        return True

    # set the client as logged and active, on database
    def set_client_logged(self, _id: str, flag: bool):
        self.client_collection.update_one({ '_id': _id }, { '$set': { 'logged': flag }})

db = DB(client.surveys)

#####
class Events():
    queues = {}

    def __init__(self):
        pass

    def ensure_queue(self, client_id: str):
        if client_id not in self.queues:
            app.logger.debug('creating queue')
            self.queues[client_id] = queue.Queue()
        elif self.queues[client_id].qsize() > 0:
            app.logger.debug('found queue, qsize: {0}'.format(self.queues[client_id].qsize()))

        return self.queues[client_id]

    def get_queues(self):
        return self.queues.values()

    def put(self, client_id: str, type: str, data: str):
        msg = f'event: {type}\ndata: {data}\n\n'

        self.ensure_queue(client_id).put(msg)

    def get(self, client_id: str):
        return self.ensure_queue(client_id).get()

    def empty(self, client_id: str):
        return self.ensure_queue(client_id).empty()

    def task_done(self, client_id: str):
        return self.ensure_queue(client_id).task_done()

    def publish(self, type: str, data: str):
        for client in db.list_logged_clients():
            app.logger.info(client['_id'])
            self.put(client['_id'], type, data)

events = Events()

#####

def verify_signature(raw_public_key, message, signature):
    return True # fake

    # loading its public key from database
    public_key = load_ssh_public_key(raw_public_key.encode('utf-8'))
    decoded_signature = base64.b64decode(signature)

    app.logger.debug('decoded_signature')
    app.logger.debug(decoded_signature)

    try:
        # verify a signature against the public key
        public_key.verify(signature, message, hashes.SHA256())
        return True

    # on invalid signature, we just pass
    except InvalidSignature:
        pass

    # on every other case, we return false
    return False

# def check_signature(f):
#     @wraps(f)
#     def decorated_function(*args, **kwargs):
#         client_id = request.headers.get('X-User-ID', '')
#         signature = request.headers.get('X-Signature', '')

#         app.logger.info('payload')
#         app.logger.info(payload)

#         app.logger.info('signature')
#         app.logger.info(signature)

#         if verify__signature(signature, client_id):
#             return f(*args, **kwargs)
#         else:
#             return abort(403, {'error': 'invalid signature'})

#     return decorated_function

def notify_clients_new_survey(survey: dict):
    s = dict(survey)
    s['dueDate'] = str(s['dueDate'])
    s['createdBy'] = db.find_client(s['createdBy'])['name']

    events.publish('new-survey', json.dumps(s))

    return True

def notify_clients_closed_survey(survey: dict):
    client_ids = [i['client_id'] for i in db.votes_collection.find({ 'survey_id': survey['_id'] })]

    for client_id in client_ids:
        events.put(client_id, 'closed-survey', survey)

    return True

##########
# ROUTES #
##########

@app.route('/register', methods=['POST'])
def register() -> tuple[list, int]:
    data = request.get_json()

    name = data.get('name')
    public_key = data.get('publicKey')

    if not name:
        abort(400, {'error': 'invalid name'})

    if not public_key:
        abort(400, {'error': 'invalid public_key'})

    client_data = db.persist_client(name, public_key)

    app.logger.info('[register][{0}] {1}'.format(client_data['_id'], client_data['name']))

    return client_data, 201

@app.route('/events/<client_id>')
def subscribe(client_id):
    # client_id = request.headers.get('X-User-ID', '')
    # signature = request.headers.get('X-Signature', '')

    app.logger.debug('client_id: {0}'.format(client_id))

    def stream():
        events.put(client_id, "welcome", "connected")

        while True:
            queue = events.ensure_queue(client_id)

            if queue.empty():
                # app.logger.debug('fila vazia')
                time.sleep(0.1) # to not melt the processor down
            else:
                msg = queue.get()
                yield msg

    return Response(stream(), content_type='text/event-stream')

# login
@app.route('/login', methods=['POST'])
def login() -> tuple[list, int]:
    client_id = request.headers.get('X-User-ID', '')
    signature = request.headers.get('X-Signature', '')

    payload = request.get_json()

    app.logger.debug(payload)

    # finding the client on the database
    client = db.find_client(client_id)

    # if the client was not found
    if not client:
        return {'message': 'client not found'}, 401

    app.logger.debug('client')
    app.logger.debug(client)

    # if verify_signature(client['public_key'], _id.encode('utf-8'), base64.b64decode(signature)):
    if verify_signature(client['public_key'], client_id.encode('utf-8'), signature):
        db.set_client_logged(client_id, True)

        app.logger.info('[login][success][{0}]'.format(client_id))
        return {'message': 'authorized'}, 200

    # on invalid signature, we log it and return false
    else:
        app.logger.info('[login][failure][{0}]'.format(client_id))
        return {'message': 'invalid signature'}, 401


@app.route('/surveys', methods=['GET', 'POST'])
def survey_endpoint() -> tuple[list, int]:
    if request.method == 'GET':
        return list_surveys()

    elif request.method == 'POST':
        return create_survey()

def list_surveys():
    client_id = request.headers.get('X-User-ID', '')
    signature = request.headers.get('X-Signature', '')

    # finding the client on the database
    client = db.find_client(client_id)

    # if the client was not found
    if not client:
        return {'message': 'client not found'}, 400

    # if verify_signature(client['public_key'], _id.encode('utf-8'), base64.b64decode(signature)):
    if not verify_signature(client['public_key'], client_id.encode('utf-8'), signature):
        return {'message': 'unauthorized'}, 403

    surveys = []

    for row in db.list_surveys():
        row['createdBy'] = db.find_client(row['createdBy'])['name']
        surveys.append(row)

    return {'data': surveys}, 200

def create_survey() -> tuple[list, int]:
    payload = request.get_json()

    client_id = request.headers.get('X-User-ID', '')
    # signature = request.headers.get('X-Signature', '')

    # finding the client on the database
    client = db.find_client(client_id)

    # if the client was not found
    if not client:
        return {'message': 'client not found'}, 400

    app.logger.debug(payload)

    title = payload['title']
    local = payload['local']
    due_date = payload['dueDate']
    options = payload['options']

    if not title:
        return {'data': 'invalid title'}, 400

    if not local:
        return {'data': 'invalid local'}, 400

    if not due_date:
        return {'data': 'invalid dueDate'}, 400

    if len(options) == 0:
        return {'data': 'invalid options'}, 400

    survey = db.persist_survey(title, client_id, local, due_date, options)

    print('[create_survey][success][{0}]'.format(survey['_id']))

    notify_clients_new_survey(survey)

    return {'data': survey}, 201

@app.route('/survey/<survey_id>', methods=['GET'])
def consult_survey(survey_id):
    client_id = request.headers.get('X-User-ID', '')
    signature = request.headers.get('X-Signature', '')

    client = db.find_client(client_id)
    survey = db.find_survey(survey_id)

    # if the client was not found
    if not client:
        return {'data': 'client not found'}, 400

    # if the survey was not found
    if not survey:
        return {'data': 'survey not found'}, 400

    if not self.verify_signature(client, client_id.encode('utf-8'), signature):
        print('[login][failure][{0}]'.format(_id))
        return {'data': 'invalid signature'}, 400

    # checking if the client has voted this survey
    voted = self.votes_collection.count_documents({ 'client_id': client_id, 'survey_id': survey_id }) > 0

    if not voted:
        return {'data': 'client vote was not registered in the survey'}, 400

    # populating data to return to client
    survey['votes'] = {}
    votes = list(self.votes_collection.find({ 'survey_id': survey_id }))

    for vote in votes:
        if not vote['option'] in survey['votes']:
            survey['votes'][vote['option']] = []

        survey['votes'][vote['option']].append(self.client_collection.find_one({ '_id': vote['client_id'] })['name'])

    return {'data': survey}, 200

@app.route('/vote', methods=['POST'])
# def vote_survey_option(self, _id: str, survey_id: str, option: str, signature) -> list:
def vote_survey_option():
    payload = request.get_json()

    client_id = request.headers.get('X-User-ID', '')
    signature = request.headers.get('X-Signature', '')

    survey_id = payload['surveyId']
    option = payload['chosenOption']

    client = db.find_client(client_id)
    survey = db.find_survey(survey_id)

    # if the client was not found
    if not client:
        return {'data': 'client not found'}, 400

    # if the survey was not found
    if not survey:
        return {'data': 'survey not found'}, 400

    # if the survey is already closed
    if survey['closed'] == True:
        return {'data': 'survey already closed'}, 400

    # the option do not belongs to this survey
    if option not in survey['options']:
        return {'data': 'option not found'}, 400

    # verifying the signature
    if verify_signature(client, option.encode('utf-8'), signature):
        # persisting vote
        if db.persist_vote(client_id, survey_id, option):
            status_text = 'ok'
            print('[voted][success][{0}][{1}]'.format(client['_id'], survey['_id']))

        else:
            status_text = 'already voted'
            print('[voted][already][{0}][{1}]'.format(client['_id'], survey['_id']))

        # if all clients voted, we notify them and close the survey
        if db.check_survey(survey):
            notify_clients_closed_survey(survey)
            db.close_survey(survey['_id'])

        return {'status': status_text}, 201

    else:
        print('[voted][failure][{0}][{1}]'.format(client['_id'], survey['_id']))
        return {'status':'invalid signature'}, 400

# just ping
@app.route('/ping', methods=['GET'])
def ping():
    data = 'pong {0}'.format(datetime.datetime.now())
    events.publish('ping', data)

    return {'message': data}, 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
