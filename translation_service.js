class TranslationError extends Error {
    constructor(message, cause = null) {
        super(message);
        this.name = 'TranslationError';
        this.cause = cause;
    }
}

function extractResponseText(payload) {
    if (typeof payload?.output_text === 'string') return payload.output_text;
    const parts = [];
    for (const item of payload?.output || []) {
        if (item?.type !== 'message') continue;
        for (const content of item.content || []) {
            if (content?.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
        }
    }
    return parts.join('');
}

function maskProtectedContent(text) {
    const values = [];
    const pattern = /```[\s\S]*?```|`[^`\n]+`|https?:\/\/[^\s<>]+|<@!?\d+>|<@&\d+>|<#\d+>|<t:\d+:[tTdDfFR]>|<a?:[A-Za-z0-9_]+:\d+>|@here|@everyone|\{\{\s*[a-zA-Z0-9_]+\s*\}\}|[*_~]{1,3}|\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*|\r?\n/giu;
    const maskedText = String(text).replace(pattern, value => {
        const token = `ANKAPROTECTED${String(values.length).padStart(4, '0')}TOKEN`;
        values.push({ token, value });
        return token;
    });
    return { maskedText, values };
}

function restoreProtectedContent(text, values) {
    let restored = String(text || '');
    for (const { token, value } of values) {
        if (!restored.includes(token)) throw new TranslationError(`Translation provider changed protected token ${token}.`);
        restored = restored.split(token).join(value);
    }
    return restored;
}

class LocalOllamaTranslationProvider {
    constructor(options = {}) {
        this.model = options.model || process.env.ANKABOT_LOCAL_TRANSLATION_MODEL || null;
        this.baseUrl = String(options.baseUrl || process.env.ANKABOT_LOCAL_TRANSLATION_URL || '').replace(/\/$/, '');
        this.timeoutMs = Number(options.timeoutMs || process.env.ANKABOT_TRANSLATION_TIMEOUT_MS) || 30_000;
    }

    get available() {
        if (!this.baseUrl || !this.model) return false;
        try {
            const hostname = new URL(this.baseUrl).hostname;
            return ['localhost', '127.0.0.1', '::1'].includes(hostname);
        } catch (error) {
            console.error('Invalid local translation URL:', error.message);
            return false;
        }
    }

    async translate(text, sourceLanguage, targetLanguage) {
        if (!this.available) throw new TranslationError('A loopback-only local translation provider is not configured.');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        if (typeof timeout.unref === 'function') timeout.unref();
        try {
            const instructions = [
                'You are a precise Discord announcement translator.',
                `Translate from ${sourceLanguage} to ${targetLanguage}.`,
                'Return only the translated text.',
                'Preserve every ANKAPROTECTED token exactly, including order and capitalization.',
                'Preserve markdown structure, emoji, whitespace intent, and tone. Do not add commentary.'
            ].join(' ');
            const response = await fetch(`${this.baseUrl}/api/generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.model,
                    stream: false,
                    prompt: `${instructions}\n\n${text}`
                }),
                signal: controller.signal
            });
            if (!response.ok) {
                const details = await response.text().catch(() => '');
                throw new TranslationError(`Local translation service returned ${response.status}${details ? `: ${details.slice(0, 300)}` : ''}`);
            }
            const payload = await response.json();
            const output = String(payload?.response || '').trim();
            if (!output) throw new TranslationError('Translation provider returned empty text.');
            return output;
        } catch (error) {
            if (error instanceof TranslationError) throw error;
            const message = error?.name === 'AbortError' ? 'Translation request timed out.' : 'Translation request failed.';
            throw new TranslationError(message, error);
        } finally {
            clearTimeout(timeout);
        }
    }
}

class TranslationService {
    constructor(provider = new LocalOllamaTranslationProvider()) {
        this.provider = provider;
    }

    get available() {
        return Boolean(this.provider?.available);
    }

    async translateTurkishToEnglish(text) {
        if (!text || !String(text).trim()) return String(text || '');
        const { maskedText, values } = maskProtectedContent(text);
        const translated = await this.provider.translate(maskedText, 'Turkish', 'English');
        return restoreProtectedContent(translated, values);
    }
}

module.exports = {
    TranslationError,
    extractResponseText,
    maskProtectedContent,
    restoreProtectedContent,
    LocalOllamaTranslationProvider,
    TranslationService
};
