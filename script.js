"use strict";
/* globals localforage */

import CONFIG from "./config.js";
import {sort, sorted, naturalCaseCompare} from "./sorting.js";

const WORK_KEY = "_work";

function $(selector, el) {
  return (el || document).querySelector(selector);
}

function debounce(fn, to) {
  let timer;
  return function(...args) {
    if (timer) {
      timer.args = args;
      return;
    }
    setTimeout(function() {
      if (!timer) {
        return;
      }
      const {args} = timer;
      timer = null;
      try {
        fn(...args);
      }
      catch (ex) {
        console.error(ex.toString(), ex);
      }
    }, to);
    timer = {args};
  };
}

async function loadRemoteLocale(code) {
  console.info("loading remote:", code);
  const req = await fetch(
    `https://raw.githubusercontent.com/${CONFIG.repo}/${CONFIG.branch}/_locales/${code}/messages.json`, {
      cache: "no-cache"
    });
  const rv = await req.json();
  return rv;
}

class Item {
  constructor(locale, id, entry, tmpl, cont) {
    this.locale = locale;
    this.id = id;
    Object.assign(this, entry);
    this.elem = tmpl.firstElementChild.cloneNode(true);
    const $ = this.elem.querySelector.bind(this.elem);
    $(".item-name").textContent = this.id;
    if (this.description) {
      $(".item-description").textContent = this.description;
    }
    else {
      $(".item-description-desc").style.display = "none";
      $(".item-description").style.display = "none";
    }
    $(".item-base").value = this.message;
    this.translatedElem = $(".item-translated");
    if (this.messageTranslated) {
      this.translatedElem.value = this.messageTranslated.trim();
    }
    this.translatedElem.addEventListener("input", this.validate.bind(this));
    this.errorsElem = $(".item-errors");
    this.statusElem = $(".item-status");
    cont.appendChild(this.elem);
    this.errors = 0;
  }

  get translated() {
    return this.translatedElem.value.trim().replace("...", "…");
  }

  get isTranslated() {
    return !!this.translated;
  }

  get isUnchanged() {
    return this.message === this.translated;
  }

  computeErrors() {
    return [];
  }

  validate() {
    try {
      try {
        if (!this.isTranslated) {
          this.statusElem.textContent = "🤚";
          this.statusElem.style.color = "yellow";
          return;
        }
        const errors = this.computeErrors();
        this.errors = errors.length;
        if (this.errors) {
          throw new Error(errors.join("\n"));
        }
        if (this.isUnchanged) {
          this.statusElem.textContent = "✓";
          this.statusElem.style.color = "yellow";
        }
        else {
          this.statusElem.textContent = "✓";
          this.statusElem.style.color = "green";
        }
      }
      finally {
        this.errorsElem.textContent = "";
        this.errorsElem.style.display = "none";
        this.translatedElem.setCustomValidity("");
      }
    }
    catch (ex) {
      this.errorsElem.textContent = ex.toString();
      this.errorsElem.style.display = "block";
      this.translatedElem.setCustomValidity(ex.toString());
      this.statusElem.textContent = "❗";
      this.statusElem.style.color = "red";
    }
    this.locale.updated(this);
  }

  toJSON() {
    const rv = {
      message: this.translated,
      description: this.description,
    };
    if (this.placeholders) {
      rv.placeholders = this.placeholders;
    }
    return rv;
  }
}

class PlaceholderItem extends Item {
  constructor(...args) {
    super(...args);
    this.holders = new Set(
      Object.keys(this.placeholders).map(e => e.toUpperCase()));
  }

  computeErrors() {
    if (!this.isTranslated) {
      return [];
    }
    const {translated} = this;
    const errors = [];
    for (const holder of this.holders) {
      if (!translated.includes(`$${holder}$`)) {
        errors.push(`Placeholder "$${holder}$" not present`);
      }
    }
    translated.replace(/\$(.+?)\$/g, (_, p) => {
      if (!this.holders.has(p)) {
        errors.push(`Placeholder "$${p}$" is invalid`);
      }
    });
    return errors;
  }
}

class Locale {
  constructor(locale) {
    this.update = debounce(this.update.bind(this), 0);

    this.statusElem = document.querySelector("#status");
    const cont = document.querySelector("article");
    cont.innerHTML = "";
    const tmpl = document.querySelector("#item").content;
    const sortedItems = sort(
      Array.from(Object.entries(locale)),
      ([id, entry]) => [
        -id.startsWith("language"),
        -!entry.messageTranslated,
        id],
      naturalCaseCompare
    );
    this.items = sortedItems.map(([id, entry]) => {
      if (entry.placeholders) {
        return new PlaceholderItem(this, id, entry, tmpl, cont);
      }
      return new Item(this, id, entry, tmpl, cont);
    });
    this.items.forEach(i => i.validate());
    this.update();
  }

  get translated() {
    return this.items.filter(i => i.isTranslated);
  }

  updated() {
    this.update();
  }

  async update() {
    try {
      await localforage.setItem(WORK_KEY, this.toString());
      const {translated} = this;
      const {length: tcount} = translated;
      const {length: count} = this.items;
      const per = (tcount / count).toLocaleString(undefined, {
        style: "percent",
        maximumFractionDigits: 1,
        minimumFractionDigits: 1,
      });
      const errors = translated.reduce((p, c) => p + c.errors, 0);
      const unchanged = translated.reduce(
        (p, c) => p + (c.isUnchanged ? 1 : 0), 0);
      const status = [`${tcount.toLocaleString()}/${count.toLocaleString()}`, per.toString()];
      if (unchanged > 0) {
        status.push(`${unchanged.toLocaleString()} unchanged`);
      }
      if (errors) {
        status.push(`${errors.toLocaleString()} errors`);
      }
      this.statusElem.textContent = status.join(" - ");
    }
    catch (ex) {
      console.error(ex);
    }
  }

  toJSON() {
    const {translated} = this;
    const rv = {};
    sorted(
      translated,
      ({id}) => [-id.startsWith("language"), id],
      naturalCaseCompare).
      forEach(i => rv[i.id] = i);
    return rv;
  }

  toString() {
    return JSON.stringify(this, undefined, 2);
  }
}

async function loadLocales() {
  const baseLocale = await loadRemoteLocale(CONFIG.baseLocale);
  const other = [];
  const work = await localforage.getItem(WORK_KEY);
  if (work) {
    try {
      other.push(JSON.parse(work));
    }
    catch (ex) {
      console.error(work, ex);
    }
  }
  other.forEach(loc => {
    for (const [id, entry] of Object.entries(loc)) {
      if (!(id in baseLocale) || !entry.message) {
        continue;
      }
      baseLocale[id].messageTranslated = entry.message;
    }
  });
  return new Locale(baseLocale);
}

async function loadRepoLocales() {
  const req = await fetch(
    `https://raw.githubusercontent.com/${CONFIG.repo}/${CONFIG.branch}/_locales/all.json`, {
      cache: "no-cache"
    });
  const list = await req.json();
  const el = $("#locales");
  for (const [code, name] of Object.entries(list)) {
    if (code === CONFIG.baseLocale) {
      continue;
    }
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = name;
    el.appendChild(opt);
  }
  console.log(list);
}

async function main() {
  $("#title").textContent = CONFIG.title;
  $("title").textContent = CONFIG.title;
  $("#byline").textContent = CONFIG.byline;

  const locales = $("#locales");

  const loaders = [loadLocales()];
  if (CONFIG.showAll) {
    loaders.push(loadRepoLocales());
  }
  else {
    locales.parentElement.removeChild(locales);
  }

  let [locale] = await Promise.all(loaders);

  async function loadLocale(json) {
    await localforage.setItem(WORK_KEY, json);
    locale = await loadLocales();
  }

  $("#reset").addEventListener("click", async () => {
    if (confirm("Do you really want to reset your work?!\nALL WILL BE GONE!")) {
      await localforage.removeItem(WORK_KEY);
      location.reload();
    }
  });

  const loadFile = $("#load-file");
  loadFile.addEventListener("change", () => {
    if (!loadFile.files.length) {
      return;
    }
    try {
      const [file] = loadFile.files;
      if (file.size > (5 << 20)) {
        alert("File too large!\nDid you select the wrong file?");
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        const {result} = reader;
        try {
          JSON.parse(result);
          await loadLocale(result);
        }
        catch (ex) {
          alert(`Couldn't load:\n${ex.toString()}`);
        }
      };
      reader.onerror = () => {
        alert("Couldn't load");
      };
      reader.readAsText(file);
    }
    finally {
      loadFile.value = "";
    }
  });
  $("#load").addEventListener("click", () => {
    loadFile.click();
  });

  if (CONFIG.showAll) {
    locales.addEventListener("change", async () => {
      const {value} = locales;
      if (!value || value === "---") {
        return;
      }
      locales.value = "---";

      if (!confirm(`Want to load the ${value} locale?\nThis will override any changes you made here.`)) {
        return;
      }
      try {
        const loc = await loadRemoteLocale(value);
        loadLocale(JSON.stringify(loc));
      }
      catch (ex) {
        console.error(ex);
      }
    });
  }

  $("#save").addEventListener("click", () => {
    const content = new Blob([locale.toString()], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.style.display = "none";
    a.setAttribute("download", "messages.json");
    a.href = URL.createObjectURL(content);
    document.body.appendChild(a);
    a.click();
  });
}

addEventListener("DOMContentLoaded", main);
