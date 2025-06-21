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

// Storyline testing functions are defined in the storyline.ejs page

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
            // Refresh storyline page if we're on it
            if (window.location.pathname.includes('storyline')) {
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

// Mobile sidebar toggle
function toggleSidebar() {
    const sidebar = document.getElementById('sidebarNav');
    if (sidebar) {
        sidebar.classList.toggle('show');
    }
}

// Fullscreen toggle
function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.log('Error attempting to enable fullscreen:', err);
            showNotification('Fullscreen not supported', 'warning');
        });
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

// Enhanced connection status updates
function updateConnectionStatus(status = 'connected') {
    const statusIndicator = document.getElementById('connectionStatus');
    const statusText = document.getElementById('connectionText');
    
    if (statusIndicator) {
        statusIndicator.className = 'status-indicator live-update';
        
        switch (status) {
            case 'connected':
                statusIndicator.classList.add('status-success');
                if (statusText) statusText.textContent = 'Connected';
                break;
            case 'disconnected':
                statusIndicator.classList.add('status-danger');
                if (statusText) statusText.textContent = 'Disconnected';
                break;
            case 'connecting':
                statusIndicator.classList.add('status-warning');
                if (statusText) statusText.textContent = 'Connecting...';
                break;
            default:
                statusIndicator.classList.add('status-info');
                if (statusText) statusText.textContent = 'Unknown';
        }
    }
}

// Animation helpers
function animateNumber(element, endValue, duration = 1000) {
    if (!element) return;
    
    const startValue = parseInt(element.textContent) || 0;
    const startTime = performance.now();
    
    function updateValue(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Easing function
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const currentValue = Math.floor(startValue + (endValue - startValue) * easeOut);
        
        element.textContent = currentValue;
        
        if (progress < 1) {
            requestAnimationFrame(updateValue);
        }
    }
    
    requestAnimationFrame(updateValue);
}

// Enhanced loading states
function showLoadingState(container, message = 'Loading...') {
    if (!container) return;
    
    const loadingHTML = `
        <div class="loading-state">
            <div class="loading-spinner">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
            </div>
            <div class="loading-message">${message}</div>
        </div>
    `;
    
    container.innerHTML = loadingHTML;
    container.classList.add('loading');
}

function hideLoadingState(container, content = '') {
    if (!container) return;
    
    container.classList.remove('loading');
    if (content) {
        container.innerHTML = content;
    }
}

// Theme toggle (future enhancement)
function toggleTheme() {
    // Placeholder for theme switching functionality
    showNotification('Theme switching coming soon!', 'info');
}

// Enhanced page transitions
function navigateWithTransition(url) {
    document.body.style.opacity = '0.7';
    document.body.style.transform = 'scale(0.98)';
    
    setTimeout(() => {
        window.location.href = url;
    }, 150);
}

// Update existing functions to use new connection status
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = function() {
        console.log('WebSocket connected');
        updateConnectionStatus('connected');
    };

    ws.onmessage = function(event) {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
    };

    ws.onclose = function() {
        console.log('WebSocket disconnected');
        updateConnectionStatus('disconnected');
        setTimeout(() => {
            updateConnectionStatus('connecting');
            connectWebSocket();
        }, 5000);
    };

    ws.onerror = function(error) {
        console.error('WebSocket error:', error);
        updateConnectionStatus('disconnected');
    };
}

document.addEventListener('DOMContentLoaded', function() {
    connectionStatus = document.getElementById('connectionStatus');
    connectWebSocket();
    
    // Initialize animations for metric cards
    const metricCards = document.querySelectorAll('.metric-card');
    metricCards.forEach((card, index) => {
        card.style.animationDelay = `${index * 0.1}s`;
    });
    
    // Animate metric values on page load
    setTimeout(() => {
        const metricValues = document.querySelectorAll('.metric-value');
        metricValues.forEach(value => {
            const endValue = parseInt(value.textContent);
            if (!isNaN(endValue)) {
                value.textContent = '0';
                animateNumber(value, endValue, 1500);
            }
        });
    }, 500);
    
    // Add smooth scrolling
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });
    
    // Enhanced keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        // Ctrl+Shift+T to go to storyline
        if (e.ctrlKey && e.shiftKey && e.key === 'T') {
            e.preventDefault();
            navigateWithTransition('/admin/storyline');
        }
        
        // Ctrl+Shift+D to go to dashboard
        if (e.ctrlKey && e.shiftKey && e.key === 'D') {
            e.preventDefault();
            navigateWithTransition('/admin');
        }
        
        // Ctrl+Shift+P to go to pipeline
        if (e.ctrlKey && e.shiftKey && e.key === 'P') {
            e.preventDefault();
            navigateWithTransition('/admin/pipeline');
        }
        
        // F11 for fullscreen (alternative to button)
        if (e.key === 'F11') {
            e.preventDefault();
            toggleFullscreen();
        }
        
        // Escape to close mobile sidebar
        if (e.key === 'Escape') {
            const sidebar = document.getElementById('sidebarNav');
            if (sidebar && sidebar.classList.contains('show')) {
                sidebar.classList.remove('show');
            }
        }
    });
    
    // Close mobile sidebar when clicking outside
    document.addEventListener('click', function(e) {
        const sidebar = document.getElementById('sidebarNav');
        const menuButton = document.querySelector('.mobile-menu-btn');
        
        if (sidebar && sidebar.classList.contains('show') && 
            !sidebar.contains(e.target) && 
            !menuButton?.contains(e.target)) {
            sidebar.classList.remove('show');
        }
    });
    
    // Auto-hide notifications after longer time for mobile
    if (window.innerWidth <= 768) {
        const originalShowNotification = showNotification;
        showNotification = function(message, type, duration = 7000) {
            originalShowNotification(message, type, duration);
        };
    }
});
