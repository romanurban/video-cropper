class AppState {
    constructor() {
        this.listeners = new Map();
        this.state = {
            file: null,
            filename: '',
            videoMetadata: null,
            isPlaying: false,
            currentTime: 0,
            duration: 0,
            isLoading: false,
            error: null
        };
    }

    subscribe(key, callback) {
        if (!this.listeners.has(key)) {
            this.listeners.set(key, new Set());
        }
        this.listeners.get(key).add(callback);

        return () => {
            const callbacks = this.listeners.get(key);
            if (callbacks) {
                callbacks.delete(callback);
            }
        };
    }

    emit(key, data) {
        const callbacks = this.listeners.get(key);
        if (callbacks) {
            callbacks.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in state callback for ${key}:`, error);
                }
            });
        }
    }

    setState(updates) {
        const prevState = { ...this.state };
        this.state = { ...this.state, ...updates };

        Object.keys(updates).forEach(key => {
            if (prevState[key] !== this.state[key]) {
                this.emit(key, this.state[key]);
                this.emit('stateChange', { key, value: this.state[key], prevValue: prevState[key] });
            }
        });
    }

    getState(key = null) {
        return key ? this.state[key] : { ...this.state };
    }

    setFile(file) {
        this.setState({
            file,
            filename: file ? file.name : '',
            error: null
        });
    }

    setVideoMetadata(metadata) {
        this.setState({
            videoMetadata: metadata,
            duration: metadata ? metadata.duration : 0
        });
    }

    setPlaybackState(isPlaying) {
        this.setState({ isPlaying });
    }

    setCurrentTime(currentTime) {
        this.setState({ currentTime });
    }

    setLoading(isLoading) {
        this.setState({ isLoading });
    }

    setError(error) {
        this.setState({ error });
    }

    reset() {
        this.setState({
            file: null,
            filename: '',
            videoMetadata: null,
            isPlaying: false,
            currentTime: 0,
            duration: 0,
            isLoading: false,
            error: null
        });
    }
}

export const appState = new AppState();