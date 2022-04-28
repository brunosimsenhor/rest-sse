// const crypto = require('crypto');
const crypto = window.crypto.subtle;

const baseURL = 'http://localhost:5001';

const axiosInstance = axios.create({
    baseURL,
    timeout: 2000,
    headers: {
      'Content-Type': 'application/json'
    },
});

const storage = {
    _storage: window.sessionStorage,
    getItem: function (k) {
        return JSON.parse(this._storage.getItem(k));
    },
    setItem: function (k, v) {
        return this._storage.setItem(k, JSON.stringify(v));
    }
};

function abtb64(buffer) {
    var binary = '';
    var bytes = new Uint8Array(buffer);
    var len = bytes.byteLength;
    for (var i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function str2ab(str) {
    const buf = new ArrayBuffer(str.length);
    const bufView = new Uint8Array(buf);

    for (let i = 0, strLen = str.length; i < strLen; i++) {
        bufView[i] = str.charCodeAt(i);
    }

    return buf;
}

let cryptoPrivateKey = null;

async function buildPrivateKey() {
    if (cryptoPrivateKey === null) {
        const privateKey = storage.getItem('privateKey');

        const aux = privateKey.split('\n').slice(1, -1);

        // base64 decode the string to get the binary data
        const binaryDerString = window.atob(aux.join('\n'));

        // convert from a binary string to an ArrayBuffer
        const binaryDer = str2ab(binaryDerString);

        cryptoPrivateKey = await crypto.importKey(
            'pkcs8',
            binaryDer,
            {
                name: 'ECDSA',
                namedCurve: 'P-521',
            },
            true,
            ['sign']
        );
    }

    return cryptoPrivateKey;
}

let signingHeaders = null;

async function buildSigningHeaders() {
    if (signingHeaders === null) {
        const { _id: id } = storage.getItem('userData');
        const privateKey = await buildPrivateKey();

        let sign = await crypto.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, str2ab(id));

        signingHeaders = {
            'X-User-ID': id,
            'X-Signature': abtb64(sign),
            'Content-type': 'application/json'
        };

        for (const i in signingHeaders) {
            axiosInstance.defaults.headers.common[i] = signingHeaders[i];
        }

        // axiosInstance.defaults.headers.common['X-User-ID'] = id;
        // axiosInstance.defaults.headers.common['X-Signature'] = abtb64(sign);
        // axiosInstance.defaults.headers.common['Content-type'] = 'application/json';
    }

    return signingHeaders
}

const app = {
    register: async function (name, publicKey) {
        const { data } = await axiosInstance.post('/register', { name, publicKey });

        return data;
    },

    postLogin: async function () {
        return axiosInstance.post('/login', {});
    },

    getSurveys: async function() {
        return axiosInstance.get('/surveys')
            .then(({ data }) => data)
            .then(({ data }) => data);
    },

    postSurveys: async function(title, local, dueDate, options) {
        return await axiosInstance.post('/surveys', JSON.stringify({ title, local, dueDate, options }))
            .then(({ data }) => data);
    },

    postVote: async function(surveyId, chosenOption) {
        return await axiosInstance.post('/vote', JSON.stringify({ surveyId, chosenOption }))
            .then(({ data }) => data);
    },
};

// Forms
const registerForm = document.getElementById('register-form');
const surveyForm = document.getElementById('survey-form');
const voteForm = document.getElementById('vote-form');

// Views
const registerView = document.getElementById('register-container');
const surveyListView = document.getElementById('survey-list-container');
const surveyFormView = document.getElementById('survey-form-container');
const voteFormView = document.getElementById('vote-form-container');

const allViews = [registerView, surveyListView, surveyFormView, voteFormView];

const hiddenClass = 'visually-hidden';

async function switchView(page) {
    await allViews.forEach(v => v.classList.add(hiddenClass))

    switch (page) {
        case 'survey-list':
            surveyListView.classList.remove(hiddenClass);
            buildSurveys();
            break;

        case 'survey-form':
            surveyFormView.classList.remove(hiddenClass);
            break;

        case 'vote-form':
            voteFormView.classList.remove(hiddenClass);
            break;

        case 'register':
        default:
            registerView.classList.remove(hiddenClass);
            break;
    }
}

const notifications = [];
const notificationList = document.querySelector('#notifications-list');

// Notifications
function addNotification({ type, text }) {
    // notificationList.querySelector('.text-muted').classList.add(hiddenClass);

    if (notifications.unshift({ type, text }) > 5) {
        notifications.splice(-1, 1);
    }

    notificationList.innerHTML = '';

    for (const i in notifications) {
        const element = document.createElement('li');
        const { type, text } = notifications[i];

        element.classList.add('list-group-item');
        element.innerHTML = `<b>${type}:</b> ${text}`;

        notificationList.appendChild(element);
    }
}

const surveys = [];
const surveyTable = document.querySelector('#survey-table');

function addSurveyToTable({ _id, title, local, createdBy, closed, options }) {
    const element = document.createElement('tr');
    const btn = document.createElement('a');
    btn.classList = 'btn btn-sm btn-primary';
    btn.onclick = () => voteSurvey({ _id, title, local, createdBy, closed, options });
    btn.innerHTML = 'Votar';

    let html = `<td>${title}</td><td>${local}</td><td>${createdBy}</td><td class="btn-container"></td>`;

    element.innerHTML = html;
    element.querySelector('.btn-container').append(btn);

    surveyTable.querySelector('tbody').appendChild(element);
}

async function buildSurveys() {
    const surveys = await app.getSurveys();

    if (surveys.length > 0) {
        surveyTable.querySelector('tfoot').classList.add(hiddenClass);
    } else {
        surveyTable.querySelector('tfoot').classList.remove(hiddenClass);
    }

    surveyTable.querySelector('tbody').innerHTML = '';

    for (const i in surveys) {
        addSurveyToTable(surveys[i]);
    }
}

function showSurveyForm() {
    switchView('survey-form');
}

function closeSurveyForm() {
    switchView('survey-list');
}

function closeVoteForm() {
    switchView('survey-list');
}

function voteSurvey({ _id, title, local, createdBy, closed, options }) {
    // console.log({ _id, title, local, createdBy, closed, options })

    document.querySelector('label[for=vote-option-1]').innerHTML = options[0];
    document.querySelector('label[for=vote-option-2]').innerHTML = options[1];
    document.querySelector('label[for=vote-option-3]').innerHTML = options[2];

    document.querySelector('#vote-id').value = _id;

    document.querySelector('#vote-title').value = title;
    document.querySelector('#vote-local').value = local;
    document.querySelector('#vote-created-by').value = createdBy;

    document.querySelector('#vote-option-1').value = options[0];
    document.querySelector('#vote-option-2').value = options[1];
    document.querySelector('#vote-option-3').value = options[2];

    // if (closed) {
    //     document.querySelector('[name=vote-submit]').classList.add('disabled');
    // } else {
    //     document.querySelector('[name=vote-submit]').classList.remove('disabled');
    // }

    switchView('vote-form');
}

let alreadyLogged = false;

async function onLogin() {
    if (alreadyLogged) {
        return;
    }

    console.log('onLogin')

    alreadyLogged = true;

    const { _id } = storage.getItem('userData');

    const source = new window.EventSource(`${baseURL}/events/${_id}`);

    source.addEventListener('new-survey', ({ data }) => {
        const d = JSON.parse(data);
        addNotification({ type: 'Nova enquete', text: d.title });
        addSurveyToTable(d);
    });

    source.addEventListener('closed-survey', ({ data }) => {
        const d = JSON.parse(data);
        addNotification({ type: 'Enquete encerrada', text: d.title });
    });

    source.addEventListener('ping', ({ data }) => {
        addNotification({ type: 'Ping', text: data });
    });

    source.addEventListener('error', (e) => {
        console.error('event source error', e);
    });
}

(async () => {
    const alreadyRegistered = storage.getItem('userData') !== null;

    console.info('[registered]', alreadyRegistered);

    if (alreadyRegistered) {
        await buildSigningHeaders();

        // login
        // we do not need the response, just to be successful
        app.postLogin()
            .then(() => {
                onLogin();
            })
            .then(() => {
                switchView('survey-list');
            })
            .catch((err) => {
                console.error('[login][error]', err);
                switchView('register');
            });

    } else {
        // // register
        switchView('register');
    }

    registerForm.addEventListener('submit', async function (e) {
        e.preventDefault();

        const formData = new FormData(registerForm);

        // data
        const name = formData.get('name');
        const privateKey = formData.get('privateKey');
        const publicKey = formData.get('publicKey');

        await app.register(name, publicKey)
            .then((data) => {
                console.log({ data })
                storage.setItem('userData', data);
                storage.setItem('privateKey', privateKey);
                storage.setItem('publicKey', publicKey);
            })
            .then(() => {
                registerForm.reset();
            })
            .then(() => {
                switchView('survey-list');
            })
            .then(() => {
                onLogin();
            })
            .then(() => {
                return buildSigningHeaders();
            });
    });

    surveyForm.addEventListener('submit', async function (e) {
        e.preventDefault();

        const formData = new FormData(surveyForm);

        // data
        const title = formData.get('title');
        const dueDate = formData.get('dueDate');
        const local = formData.get('local');
        const options = [
            formData.get('options1'),
            formData.get('options2'),
            formData.get('options3'),
        ];

        // console.log('formData', { title, local, dueDate, options });

        await app.postSurveys(title, local, dueDate, options)
            .then(({ data }) => {
                console.log({ data })
            })
            .then(() => {
                surveyForm.reset();
            })
            .then(() => {
                switchView('survey-list');
            });
    });

    voteForm.addEventListener('submit', async function (e) {
        e.preventDefault();

        const formData = new FormData(voteForm);

        // data
        const surveyId = formData.get('_id');
        const chosenOption = formData.get('chosenOption');

        // console.log('formData', { title, local, dueDate, options });

        await app.postVote(surveyId, chosenOption)
            .then(({ status }) => {
                alert(status)
            })
            .then(() => {
                voteForm.reset();
            })
            .then(() => {
                switchView('survey-list');
            });
    });
})();
