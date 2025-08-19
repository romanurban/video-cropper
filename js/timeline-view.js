import { appState } from './state.js';
import { formatTime, debounce } from './utils.js';

export class TimelineView {
    constructor(container) {
        this.container = container;
        this.timeline = null;
        this.track = null;
        this.progress = null;
        this.playhead = null;
        this.ticksContainer = null;
        this.duration = 0;
        this.currentTime = 0;
        this.ticks = [];
        
        this.handleResize = debounce(this.renderTicks.bind(this), 100);
        
        this.init();
    }

    init() {
        this.createElements();
        this.setupEventListeners();
        this.setupStateSubscriptions();
    }

    createElements() {
        this.timeline = document.createElement('div');
        this.timeline.className = 'timeline';
        
        this.track = document.createElement('div');
        this.track.className = 'timeline-track';
        
        this.progress = document.createElement('div');
        this.progress.className = 'timeline-progress';
        
        this.playhead = document.createElement('div');
        this.playhead.className = 'timeline-playhead';
        
        this.ticksContainer = document.createElement('div');
        this.ticksContainer.className = 'timeline-ticks';
        
        this.track.appendChild(this.progress);
        this.timeline.appendChild(this.track);
        this.timeline.appendChild(this.playhead);
        this.timeline.appendChild(this.ticksContainer);
        this.container.appendChild(this.timeline);
    }

    setupEventListeners() {
        window.addEventListener('resize', this.handleResize);
        
        const resizeObserver = new ResizeObserver(() => {
            this.handleResize();
        });
        
        if (this.container) {
            resizeObserver.observe(this.container);
        }
    }

    setupStateSubscriptions() {
        appState.subscribe('videoMetadata', (metadata) => {
            if (metadata) {
                this.duration = metadata.duration;
                this.renderTicks();
            } else {
                this.duration = 0;
                this.clearTicks();
            }
        });

        appState.subscribe('currentTime', (currentTime) => {
            this.currentTime = currentTime;
            this.updateProgress();
        });
    }

    getTimeIntervals(duration) {
        if (duration <= 60) {
            return { minor: 5, major: 15 };
        } else if (duration <= 300) {
            return { minor: 10, major: 30 };
        } else if (duration <= 1200) {
            return { minor: 30, major: 120 };
        } else if (duration <= 3600) {
            return { minor: 60, major: 300 };
        } else {
            return { minor: 300, major: 900 };
        }
    }

    renderTicks() {
        if (!this.duration || this.duration <= 0) return;
        
        this.clearTicks();
        
        const containerRect = this.container.getBoundingClientRect();
        const width = containerRect.width;
        if (width <= 0) return;
        
        const { minor, major } = this.getTimeIntervals(this.duration);
        const minLabelSpacing = 60;
        
        for (let time = 0; time <= this.duration; time += minor) {
            const isMajor = time % major === 0;
            const position = (time / this.duration) * width;
            
            const tick = document.createElement('div');
            tick.className = `tick ${isMajor ? 'major' : 'minor'}`;
            tick.style.left = `${position}px`;
            
            this.ticksContainer.appendChild(tick);
            
            if (isMajor) {
                const shouldShowLabel = this.shouldShowLabel(position, width, minLabelSpacing);
                if (shouldShowLabel) {
                    const label = document.createElement('div');
                    label.className = 'tick-label';
                    label.style.left = `${position}px`;
                    label.textContent = formatTime(time);
                    this.ticksContainer.appendChild(label);
                }
            }
        }
    }

    shouldShowLabel(position, totalWidth, minSpacing) {
        const existingLabels = this.ticksContainer.querySelectorAll('.tick-label');
        
        for (const label of existingLabels) {
            const labelPosition = parseFloat(label.style.left);
            if (Math.abs(position - labelPosition) < minSpacing) {
                return false;
            }
        }
        
        return position >= minSpacing / 2 && position <= totalWidth - minSpacing / 2;
    }

    updateProgress() {
        if (!this.duration || this.duration <= 0) return;
        
        const progressPercent = (this.currentTime / this.duration) * 100;
        const progressPercentClamped = Math.max(0, Math.min(100, progressPercent));
        
        this.progress.style.width = `${progressPercentClamped}%`;
        this.playhead.style.left = `${progressPercentClamped}%`;
    }

    clearTicks() {
        if (this.ticksContainer) {
            this.ticksContainer.innerHTML = '';
        }
    }

    destroy() {
        window.removeEventListener('resize', this.handleResize);
        if (this.container && this.timeline) {
            this.container.removeChild(this.timeline);
        }
    }
}