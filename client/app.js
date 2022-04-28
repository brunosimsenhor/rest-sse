// const crypto = require('crypto');
const crypto = window.crypto.subtle;

const baseURL = 'http://localhost:5001/';

const axiosInstance = axios.create({
    baseURL,
    timeout: 2000,
    headers: {
      'Content-Type': 'application/json'
    },
    transformRequest: [async function (data, headers) {
        try {
            const { _id: id } = storage.getItem('userData');

            const payload = JSON.stringify(data);
            // const payload = id;

            const privateKey = await buildPrivateKey();
            // const sign = await crypto.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, str2ab(payload));

            // console.log({ privateKey })

            // const signingHeaders = await buildSigningHeaders(id);
            // console.log(signingHeaders)

            // for (i in signingHeaders) {
            //     headers[i] = signingHeaders[i];
            // }

            headers['X-User-ID'] = id;
            headers['X-Signature'] = "banzai"
            // headers['X-Signature'] = _arrayBufferToBase64(sign);

            // console.log(headers['X-Signature'])

            console.log('oiasd')

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

function _arrayBufferToBase64(buffer) {
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

async function buildSigningHeaders(payload) {
    const { _id: id } = storage.getItem('userData');
    const privateKey = await buildPrivateKey();

    console.log({ privateKey });

    let asdf = await crypto.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, str2ab(JSON.stringify(payload)));

    return {
        'X-User-ID': id,
        'X-Signature': _arrayBufferToBase64(),
    };
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

        // const headers = await buildSigningHeaders();

        // console.log({ headers })

        const { data } = await axiosInstance.post('/login', { id });
        // const { data } = await axiosInstance.post('/login', { id }, {
        //     headers,
        // });

        return data;
    }
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
            break;
        case 'register':
        default:
            registerView.classList.remove(hiddenClass);
            break;
    }
}

(async () => {
    const alreadyRegistered = storage.getItem('userData') !== null;

    console.info('[registered]', alreadyRegistered);

    if (alreadyRegistered) {
        // login
        try {
            const loginResponse = await app.login();

            console.log({ loginResponse });
            switchView('survey-list');

            // let source = new EventSource(`${baseURL}/events`, {
            //     headers: buildSigningHeaders()
            // });

            // source.addEventListener('*', (e) => {
            //     console.log('incoming event:', e.type);
            //     console.info(e.data);
            // });

            // source.addEventListener('error', (e) => {
            //     console.log('incoming event:', 'error');
            //     console.error(e);
            // });

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
