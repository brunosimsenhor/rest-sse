// const crypto = require('crypto');
const crypto = window.crypto.subtle;

const baseURL = 'http://localhost:5001';

const axiosInstance = axios.create({
    baseURL,
    timeout: 2000,
    headers: {
      'Content-Type': 'application/json'
    },
    transformRequest: [async function (data, headers) {
        try {
            for (i in signingHeaders) {
                headers[i] = signingHeaders[i];
            }

        } catch(err) {
            console.error(err)
        }

        return data;
    }, ...axios.defaults.transformRequest],
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
        };
    }

    return signingHeaders
}

const app = {
    register: async function (name, privateKey, publicKey) {
        const { data } = await axiosInstance.post('/register', { name, publicKey });

        storage.setItem('userData', data);
        storage.setItem('privateKey', privateKey);
        storage.setItem('publicKey', publicKey);

        switchView('survey-list');

        return data;
    },

    login: async function () {
        const { _id: id } = storage.getItem('userData');
        const { data } = await axiosInstance.post('/login', { id });

        return data;
    },

    getSurveys: async function() {
        const { data } = await axiosInstance.get('/surveys');

        return data;
    },
};

// Forms
const registerForm = document.getElementById('register-form');

// Views
const registerView = document.getElementById('register-container');
const surveyListView = document.getElementById('survey-list-container');

const allViews = [registerView, surveyListView];

const hiddenClass = 'visually-hidden';

async function switchView(page) {
    await allViews.forEach(v => v.classList.add(hiddenClass))

    switch (page) {
        case 'survey-list':
            surveyListView.classList.remove(hiddenClass);
            buildSurveys();
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
function addNotification(event) {
    if (notifications.unshift(event) > 5) {
        notifications.splice(-1, 1);
    }

    notificationList.innerHTML = '';

    for (const i in notifications) {
        const element = document.createElement('li');
        const { data, type } = notifications[i];

        element.innerHTML = `<b>${type}:</b> ${data}`;

        notificationList.appendChild(element);
    }
}

const surveys = [];
const surveyTable = document.querySelector('#survey-table');

function addSurveyToTable({ name, createdBy }) {
    const element = document.createElement('tr');
    const { data, type } = notifications[i];

    element.innerHTML = `<td>${name}</td><td>${createdBy}</td><td><a href="javascript:void(0);">Votar</a></td>`;

    notificationList.appendChild(element);
}

async function buildSurveys() {
    const surveys = await app.getSurveys();

    if (surveys.length > 0) {
        surveyTable.querySelector('tfoot').classList.add(hiddenClass);
    } else {
        surveyTable.querySelector('tfoot').classList.remove(hiddenClass);
    }

    for (const i in surveys) {
        addSurveyToTable(surveys[i]);
    }

    const source = new EventSource(`${baseURL}/events`, {
        headers: await buildSigningHeaders(),
    });

    source.onmessage = (event) => {
        const parsedData = JSON.parse(event.data);
    };

    source.addEventListener('new-survey', addNotification);
    source.addEventListener('ping', addNotification);

    source.addEventListener('error', (e) => {
        console.log('incoming event:', 'error');
        console.error(e);
    });
}

(async () => {
    const alreadyRegistered = storage.getItem('userData') !== null;

    console.info('[registered]', alreadyRegistered);

    if (alreadyRegistered) {
        await buildSigningHeaders();

        // login
        try {
            // we do not need the response, just to be successful
            await app.login();

            switchView('survey-list');

        } catch (err) {
            console.error('[login][error]', err);

            switchView('register');
        }

    } else {
        // // register
        switchView('register');
    }

    registerForm.addEventListener('submit', function (e) {
        e.preventDefault();

        const data = new FormData(registerForm);

        // data
        const name = data.get('name');
        const privateKey = data.get('privateKey');
        const publicKey = data.get('publicKey');

        app.register(name, privateKey, publicKey);
    });
})()
