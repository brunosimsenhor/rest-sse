const SSE_STREAM = process.env.SSE_STREAM || 'http://server:3000/events';

const source = new EventSource(SSE_STREAM);

source.addEventListener('publish', function(event) {
    var data = JSON.parse(event.data);
    console.log("The server says " + data.message);
}, false);

source.addEventListener('error', function(event) {
    console.log("Error"+ event)
    alert("Failed to connect to event stream. Is Redis running?");
}, false);
