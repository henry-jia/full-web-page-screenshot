"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const FwpsI18n = require("../extension/i18n.js");

const extensionRoot = path.join(__dirname, "..", "extension");
const localesRoot = path.join(extensionRoot, "_locales");

function loadCatalog(locale) {
  return JSON.parse(
    fs.readFileSync(path.join(localesRoot, locale, "messages.json"), "utf8"),
  );
}

const locales = fs
  .readdirSync(localesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const catalogs = new Map(locales.map((locale) => [locale, loadCatalog(locale)]));
const defaultCatalog = catalogs.get("zh_TW");

function placeholderTokens(message) {
  return [...String(message).matchAll(/\$[1-9]/g)]
    .map((match) => match[0])
    .sort();
}

function collectSourcesText() {
  const sources = [
    path.join(extensionRoot, "background.js"),
    path.join(extensionRoot, "popup", "popup.js"),
    path.join(extensionRoot, "popup", "popup.html"),
    path.join(extensionRoot, "editor", "editor.js"),
    path.join(extensionRoot, "editor", "editor.html"),
    path.join(extensionRoot, "manifest.json"),
  ];

  return sources.map((source) => fs.readFileSync(source, "utf8")).join("\n");
}

function collectDirectlyReferencedKeys() {
  const keys = new Set();
  const text = collectSourcesText();

  for (const match of text.matchAll(/\bt\("([a-z0-9_]+)"/g)) {
    keys.add(match[1]);
  }
  for (const match of text.matchAll(/data-i18n(?:-aria-label|-alt|-placeholder)?="([a-z0-9_]+)"/g)) {
    keys.add(match[1]);
  }
  for (const match of text.matchAll(/__MSG_([a-z0-9_]+)__/g)) {
    keys.add(match[1]);
  }

  return keys;
}

test("both zh_TW and en locales ship with identical key sets", () => {
  assert.deepEqual(locales, ["en", "zh_TW"]);

  const reference = Object.keys(defaultCatalog).sort();
  assert.ok(reference.length > 0);

  for (const locale of locales) {
    assert.deepEqual(
      Object.keys(catalogs.get(locale)).sort(),
      reference,
      `${locale} key set diverges from zh_TW`,
    );
  }
});

test("every catalog message is a non-empty string", () => {
  for (const [locale, catalog] of catalogs) {
    for (const [key, entry] of Object.entries(catalog)) {
      assert.equal(typeof entry.message, "string", `${locale}:${key}`);
      assert.ok(entry.message.length > 0, `${locale}:${key} is empty`);
    }
  }
});

test("placeholder tokens match across locales for every key", () => {
  for (const key of Object.keys(defaultCatalog)) {
    const reference = placeholderTokens(defaultCatalog[key].message);
    for (const locale of locales) {
      assert.deepEqual(
        placeholderTokens(catalogs.get(locale)[key].message),
        reference,
        `${locale}:${key} placeholders diverge from zh_TW`,
      );
    }
  }
});

test("every message key referenced in code exists in the catalogs", () => {
  const referenced = collectDirectlyReferencedKeys();
  assert.ok(referenced.size > 0);

  for (const key of referenced) {
    for (const locale of locales) {
      assert.ok(
        catalogs.get(locale)[key],
        `${locale} is missing key ${key} referenced in code`,
      );
    }
  }
});

test("every catalog key is referenced in code", () => {
  const text = collectSourcesText();

  for (const key of Object.keys(defaultCatalog)) {
    assert.ok(text.includes(key), `catalog key ${key} is never used`);
  }
});

test("manifest declares zh_TW as the default locale", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(extensionRoot, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.default_locale, "zh_TW");
  assert.equal(manifest.name, "__MSG_extension_name__");
  assert.equal(manifest.description, "__MSG_extension_description__");
});

test("formatMessage substitutes positional placeholders", () => {
  assert.equal(
    FwpsI18n.formatMessage("正在擷取第 $1 / $2 段。", [3, 12]),
    "正在擷取第 3 / 12 段。",
  );
  assert.equal(FwpsI18n.formatMessage("$1 only", 7), "7 only");
});

test("formatMessage escapes double dollars and drops missing values", () => {
  assert.equal(FwpsI18n.formatMessage("$$1 and $1 and $2", ["x"]), "$1 and x and ");
});

test("resolveMessage falls back to the default catalog for missing keys", () => {
  const fallback = { greeting: { message: "你好 $1" } };
  assert.equal(FwpsI18n.resolveMessage({}, fallback, "greeting", ["阿明"]), "你好 阿明");
  assert.equal(FwpsI18n.resolveMessage({}, fallback, "absent_key"), "absent_key");
  assert.equal(FwpsI18n.resolveMessage(null, null, "absent_key"), "absent_key");
});

test("the browser translator returns the key when the lookup fails", () => {
  const translate = FwpsI18n.createBrowserTranslator({
    i18n: {
      getMessage(key, substitutions) {
        const entry = defaultCatalog[key];
        return entry ? FwpsI18n.formatMessage(entry.message, substitutions) : "";
      },
    },
  });

  assert.equal(translate("status_idle"), "待命");
  assert.equal(translate("capture_progress", [2, 9]), "正在擷取第 2 / 9 段。");
  assert.equal(translate("no_such_key"), "no_such_key");
});
