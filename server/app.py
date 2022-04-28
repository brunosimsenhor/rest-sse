import os
import sys
import uuid
import time
import queue
import base64
import datetime
import threading

# flask
from flask import Flask, request, Response, abort, jsonify
from flask_cors import CORS

# cryptography
from cryptography.hazmat.primitives.serialization import load_pem_public_key

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
            'created_by': client_id,
            'local': local,
            'due_date': datetime.datetime.fromisoformat(due_date),
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

    # set the client as logged and active, on database
    def set_client_logged(self, _id: str, flag: bool):
        self.client_collection.update_one({ '_id': _id }, { '$set': { 'logged': flag }})

    def list_surveys():
        

db = DB(client.surveys)

#####
class Events():
    queues = {}

    def __init__(self):
        pass

    def ensure_queue(self, client_id: str):
        self.queues[client_id] = self.queues.get(client_id, queue.Queue())

        return self.queues[client_id]

    def get_queues(self):
        return self.queues.values()

    def put(self, client_id: str, type: str, data: str):
        msg = f'event: {type}\ndata: {data}\n\n'
        app.logger.info(msg)
        self.ensure_queue(client_id).put(msg)

    def get(self, client_id: str):
        return self.ensure_queue(client_id).get()

    def empty(self, client_id: str):
        return self.ensure_queue(client_id).empty()

    def task_done(self, client_id: str):
        return self.ensure_queue(client_id).task_done()

    def publish(self, type: str, data: str):
        for client_id in self.queues.keys():
            self.put(client_id, type, data)

events = Events()

#####

def verify_signature(raw_public_key, message, signature):
    return True # fake

    # loading its public key from database
    public_key = load_pem_public_key(raw_public_key.encode('utf-8'))

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

@app.route('/events')
def subscribe():
    client_id = request.headers.get('X-User-ID', '')
    signature = request.headers.get('X-Signature', '')

    def stream():
        queue = events.ensure_queue(client_id)

        events.put(client_id, "welcome", "connected")

        while True:
            if queue.empty():
                time.sleep(0.1) # to not melt down the processor

            # msg = queue.get()
            # queue.task_done()

            yield queue.get()

    return Response(stream(), content_type='text/event-stream')

# # logout
# def logout(self, _id: str) -> bool:
#     db.set_logged(_id, False)

#     app.logger.info('[logout][success][{0}]'.format(_id))

#     return {'message': 'logged out successfulyy'}

# login
@app.route('/login', methods=['POST'])
def login() -> tuple[list, int]:
    app.logger.info('request.method')
    app.logger.info(request.method)

    # if request.method == 'OPTIONS':
    #     return '', 200

    payload = request.get_json()

    _id = request.headers.get('X-User-ID', '')
    signature = request.headers.get('X-Signature', '')

    # finding the client on the database
    client = db.find_client(_id)

    # if the client was not found
    if not client:
        return {'message': 'client not found'}, 401

    # if verify_signature(client['public_key'], _id.encode('utf-8'), base64.b64decode(signature)):
    if verify_signature(client['public_key'], _id.encode('utf-8'), signature):
        db.set_client_logged(_id, True)

        app.logger.info('[login][success][{0}]'.format(_id))
        return {'message': 'authorized'}, 200

    # on invalid signature, we log it and return false
    else:
        app.logger.info('[login][failure][{0}]'.format(_id))
        return {'message': 'invalid signature'}, 401


@app.route('/surveys', methods=['GET'])
def list_available_surveys() -> tuple[list, int]:
    _id = request.headers.get('X-User-ID', '')
    signature = request.headers.get('X-Signature', '')

    app.logger.debug(_id)

    # finding the client on the database
    client = db.find_client(_id)

    # if the client was not found
    if not client:
        return {'message': 'client not found'}, 400

    surveys = []

    for row in db.list_surveys():
        row['created_by'] = db.find_client(row['created_by'])['name']
        surveys.append(row)

    return {'data': surveys}, 200

# just ping
@app.route('/ping', methods=['GET'])
def ping():
    data = 'pong {0}'.format(datetime.datetime.now())
    events.publish('ping', data)

    return {'message': data}, 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
