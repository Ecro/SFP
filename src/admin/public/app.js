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

// Storyline testing functions
async function runStorylineTest() {
    // This function is defined in the storyline-test.ejs page
    // Keeping this as a placeholder for global access
    console.log('runStorylineTest called - should be handled by page-specific script');
}

async function triggerStorylineGeneration(options = {}) {
    try {
        showNotification('Starting storyline generation...', 'info');
        
        const response = await fetch('/api/test/storylines', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(options)
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification(`Generated ${result.data.storylines.length} storylines successfully!`, 'success');
            return result.data;
        } else {
            throw new Error(result.message || 'Failed to generate storylines');
        }
    } catch (error) {
        console.error('Storyline generation error:', error);
        showNotification('Failed to generate storylines: ' + error.message, 'error');
        throw error;
    }
}

async function selectStorylineForProduction(testId, storylineId) {
    try {
        showNotification('Starting video production...', 'info');
        
        const response = await fetch(`/api/test/storylines/${testId}/select/${storylineId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            showNotification(
                `Video production started! Job ID: ${result.data.videoJobId}`, 
                'success'
            );
            
            // Broadcast update via WebSocket if available
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'storyline_selected',
                    data: {
                        testId,
                        storylineId,
                        jobId: result.data.videoJobId
                    }
                }));
            }
            
            return result.data;
        } else {
            throw new Error(result.message || 'Failed to start video production');
        }
    } catch (error) {
        console.error('Storyline selection error:', error);
        showNotification('Failed to start video production: ' + error.message, 'error');
        throw error;
    }
}

// Enhanced WebSocket message handling for storyline updates
function handleWebSocketMessage(data) {
    switch(data.type) {
        case 'status':
            updateLastUpdated();
            break;
        case 'trend_discovery_result':
            showNotification('Trend discovery completed', 'success');
            setTimeout(() => window.location.reload(), 2000);
            break;
        case 'storyline_test_complete':
            showNotification(`Storyline test completed: ${data.data.storylinesGenerated} suggestions created`, 'success');
            // Refresh storyline test page if we're on it
            if (window.location.pathname.includes('storyline-test')) {
                setTimeout(() => window.location.reload(), 2000);
            }
            break;
        case 'storyline_selected':
            showNotification(`Video production started for storyline: ${data.data.storylineId}`, 'info');
            break;
        case 'video_job_progress':
            if (data.data.stage) {
                showNotification(`Video job progress: ${data.data.stage}`, 'info');
            }
            break;
        case 'error':
            showNotification(data.data.message, 'error');
            break;
    }
}

// Helper function to format numbers with commas
function formatNumber(num) {
    if (typeof num === 'number') {
        return num.toLocaleString();
    }
    return num;
}

// Helper function to format duration
function formatDuration(seconds) {
    if (seconds < 60) {
        return `${seconds}s`;
    } else if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}m ${remainingSeconds}s`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${minutes}m`;
    }
}

// Enhanced notification function with auto-dismiss for info messages
function showNotification(message, type, duration = 5000) {
    const alertClass = type === 'success' ? 'alert-success' :
                       type === 'error' ? 'alert-danger' : 
                       type === 'warning' ? 'alert-warning' : 'alert-info';

    const notification = document.createElement('div');
    notification.className = `alert ${alertClass} alert-dismissible fade show position-fixed`;
    notification.style.top = '20px';
    notification.style.right = '20px';
    notification.style.zIndex = '9999';
    notification.style.maxWidth = '400px';
    notification.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

    document.body.appendChild(notification);

    // Auto-dismiss based on type and duration
    const autoDismissTime = type === 'error' ? duration * 2 : duration;
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, autoDismissTime);
}

document.addEventListener('DOMContentLoaded', function() {
    connectionStatus = document.getElementById('connectionStatus');
    connectWebSocket();
    
    // Add keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        // Ctrl+Shift+T to go to storyline test
        if (e.ctrlKey && e.shiftKey && e.key === 'T') {
            e.preventDefault();
            window.location.href = '/admin/storyline-test';
        }
        
        // Ctrl+Shift+D to go to dashboard
        if (e.ctrlKey && e.shiftKey && e.key === 'D') {
            e.preventDefault();
            window.location.href = '/admin';
        }
        
        // Ctrl+Shift+P to go to pipeline
        if (e.ctrlKey && e.shiftKey && e.key === 'P') {
            e.preventDefault();
            window.location.href = '/admin/pipeline';
        }
    });
});
