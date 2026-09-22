(function exposeFwpsI18n(root, factory) {
  "use strict";

  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.FwpsI18n = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildFwpsI18nApi() {
  "use strict";

  function formatMessage(template, substitutions) {
    const values = substitutions === undefined
      ? []
      : Array.isArray(substitutions)
        ? substitutions
        : [substitutions];

    return String(template).replace(/\$\$|\$[1-9]/g, (token) => {
      if (token === "$$") {
        return "$";
      }

      const value = values[Number(token.slice(1)) - 1];
      return value === undefined || value === null ? "" : String(value);
    });
  }

  function resolveMessage(catalog, fallbackCatalog, key, substitutions) {
    const entry =
      (catalog && catalog[key]) || (fallbackCatalog && fallbackCatalog[key]);

    if (!entry || typeof entry.message !== "string") {
      return String(key);
    }

    return formatMessage(entry.message, substitutions);
  }

  function createBrowserTranslator(browserApi) {
    return function translate(key, substitutions) {
      try {
        const message = browserApi.i18n.getMessage(key, substitutions || []);
        return message || String(key);
      } catch {
        return String(key);
      }
    };
  }

  return Object.freeze({
    createBrowserTranslator,
    formatMessage,
    resolveMessage,
  });
});
