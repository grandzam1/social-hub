import assert from "node:assert/strict";
import test from "node:test";
import {
  downloadPercent,
  overallDownloadPercent,
} from "./download-file.ts";

test("percent is a whole number only when the total is known", () => {
  assert.equal(downloadPercent(42, 100), 42);
  assert.equal(downloadPercent(1, 3), 33);
  assert.equal(downloadPercent(0, 0), null);
  assert.equal(downloadPercent(10, Number.NaN), null);
});

test("overall progress includes the active file", () => {
  assert.equal(overallDownloadPercent(1, 68, 3), 56);
  assert.equal(overallDownloadPercent(1, null, 3), null);
  assert.equal(overallDownloadPercent(3, 0, 3), 100);
});
