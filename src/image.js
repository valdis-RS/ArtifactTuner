// The loaded BIN: an untouched original, the working copy being edited, the
// reference used for compare highlighting, and undo/redo as byte patches.

export class BinImage {
  constructor(bytes, name) {
    this.name = name;
    this.original = Uint8Array.from(bytes);
    this.working = Uint8Array.from(bytes);
    this.reference = this.original;
    this.referenceName = '';
    this.undoStack = [];
    this.redoStack = [];
    this.changed = new Set();
    this.unsaved = false;
  }

  apply(label, patches) {
    if (!patches.length) return false;
    this.#write(patches, 'after');
    this.undoStack.push({ label, patches });
    this.redoStack.length = 0;
    return true;
  }

  undo() {
    const group = this.undoStack.pop();
    if (!group) return null;
    this.#write(group.patches, 'before');
    this.redoStack.push(group);
    return group;
  }

  redo() {
    const group = this.redoStack.pop();
    if (!group) return null;
    this.#write(group.patches, 'after');
    this.undoStack.push(group);
    return group;
  }

  #write(patches, side) {
    for (const p of patches) {
      this.working[p.off] = p[side];
      if (this.working[p.off] === this.original[p.off]) this.changed.delete(p.off);
      else this.changed.add(p.off);
    }
    this.unsaved = true;
  }

  editedOffsets() {
    return [...this.changed].sort((a, b) => a - b);
  }

  setReference(bytes, name) {
    if (bytes.length !== this.original.length) {
      throw new Error(`The compare file is ${bytes.length} bytes but the loaded BIN is ${this.original.length} bytes`);
    }
    this.reference = Uint8Array.from(bytes);
    this.referenceName = name;
  }

  clearReference() {
    this.reference = this.original;
    this.referenceName = '';
  }

  differsInRange(start, end) {
    for (let i = start; i < end; i++) if (this.working[i] !== this.reference[i]) return true;
    return false;
  }

  markSaved() {
    this.unsaved = false;
  }
}
