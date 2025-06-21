let ws;
let connectionStatus;

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = function() {
        console.log('WebSocket connected');
        if (connectionStatus) connectionStatus.className = 'status-indicator status-success';
    };

    ws.onmessage = function(event) {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };

    ws.onclose = function() {
        console.log('WebSocket disconnected');
        if (connectionStatus) connectionStatus.className = 'status-indicator status-danger';
        setTimeout(connectWebSocket, 5000);
    };

    ws.onerror = function(error) {
        console.error('WebSocket error:', error);
        if (connectionStatus) connectionStatus.className = 'status-indicator status-warning';
    };
}

function handleWebSocketMessage(data) {
    switch(data.type) {
        case 'status':
            updateLastUpdated();
            break;
        case 'trend_discovery_result':
            showNotification('Trend discovery completed', 'success');
            setTimeout(() => window.location.reload(), 2000);
            break;
        case 'error':
            showNotification(data.data.message, 'error');
            break;
    }
}

function triggerTrendDiscovery() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'trigger_trend_discovery' }));
        showNotification('Trend discovery started...', 'info');
    } else {
        fetch('/api/trigger/trends', { method: 'POST' })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    showNotification('Trend discovery completed', 'success');
                    setTimeout(() => window.location.reload(), 2000);
                } else {
                    showNotification(data.message, 'error');
                }
            })
            .catch(() => {
                showNotification('Failed to trigger trend discovery', 'error');
            });
    }
}

function refreshData() {
    window.location.reload();
}

function updateLastUpdated() {
    const el = document.getElementById('lastUpdated');
    if (el) el.textContent = new Date().toLocaleString();
}

function showNotification(message, type) {
    const alertClass = type === 'success' ? 'alert-success' :
                       type === 'error' ? 'alert-danger' : 'alert-info';

    const notification = document.createElement('div');
    notification.className = `alert ${alertClass} alert-dismissible fade show position-fixed`;
    notification.style.top = '20px';
    notification.style.right = '20px';
    notification.style.zIndex = '9999';
    notification.innerHTML = `${message}<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;

    document.body.appendChild(notification);

    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 5000);
}

document.addEventListener('DOMContentLoaded', function() {
    connectionStatus = document.getElementById('connectionStatus');
    connectWebSocket();
});
