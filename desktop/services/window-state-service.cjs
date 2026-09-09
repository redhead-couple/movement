const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_WINDOW_STATE = Object.freeze({
  width: 1240,
  height: 820,
  maximized: false
});
const MIN_VISIBLE_WIDTH = 120;
const MIN_VISIBLE_HEIGHT = 80;

function validInteger(value) {
  return Number.isInteger(value) && Number.isSafeInteger(value);
}

function visibleOnAnyDisplay(bounds, workAreas) {
  if (!Array.isArray(workAreas) || workAreas.length === 0) return true;

  return workAreas.some(workArea => {
    if (
      !workArea
      || !validInteger(workArea.x)
      || !validInteger(workArea.y)
      || !validInteger(workArea.width)
      || !validInteger(workArea.height)
    ) {
      return false;
    }

    const overlapWidth = Math.min(
      bounds.x + bounds.width,
      workArea.x + workArea.width
    ) - Math.max(bounds.x, workArea.x);
    const overlapHeight = Math.min(
      bounds.y + bounds.height,
      workArea.y + workArea.height
    ) - Math.max(bounds.y, workArea.y);

    return overlapWidth >= MIN_VISIBLE_WIDTH && overlapHeight >= MIN_VISIBLE_HEIGHT;
  });
}

function normalizeWindowState(candidate, workAreas = []) {
  const source = candidate && typeof candidate === 'object' ? candidate : {};
  const width = validInteger(source.width) && source.width >= 840 && source.width <= 10000
    ? source.width
    : DEFAULT_WINDOW_STATE.width;
  const height = validInteger(source.height) && source.height >= 640 && source.height <= 10000
    ? source.height
    : DEFAULT_WINDOW_STATE.height;
  const state = {
    width,
    height,
    maximized: source.maximized === true
  };

  if (validInteger(source.x) && validInteger(source.y)) {
    const positionedBounds = { x: source.x, y: source.y, width, height };
    if (visibleOnAnyDisplay(positionedBounds, workAreas)) {
      state.x = source.x;
      state.y = source.y;
    }
  }

  return state;
}

function loadWindowState(filename, workAreas = []) {
  try {
    const source = fs.readFileSync(filename, 'utf8');
    return normalizeWindowState(JSON.parse(source), workAreas);
  } catch {
    return normalizeWindowState(null, workAreas);
  }
}

function saveWindowState(filename, state) {
  const directory = path.dirname(filename);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

module.exports = {
  DEFAULT_WINDOW_STATE,
  loadWindowState,
  normalizeWindowState,
  saveWindowState,
  visibleOnAnyDisplay
};
