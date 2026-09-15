const fs = require('fs');
const path = require('path');

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function readJson(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath)) return clone(fallback);
        const text = fs.readFileSync(filePath, 'utf8').trim();
        return text ? JSON.parse(text) : clone(fallback);
    } catch (error) {
        console.error(`${path.basename(filePath)} could not be read:`, error);
        return clone(fallback);
    }
}

function writeJsonAtomic(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
}

class JsonStore {
    constructor(filePath, fallback) {
        this.filePath = filePath;
        this.fallback = fallback;
        this.data = readJson(filePath, fallback);
    }

    reload() {
        this.data = readJson(this.filePath, this.fallback);
        return this.data;
    }

    save() {
        writeJsonAtomic(this.filePath, this.data);
    }
}

module.exports = { clone, readJson, writeJsonAtomic, JsonStore };
