const toggle = document.querySelector(".nav-toggle");
const nav = document.getElementById("navigation");
for (const link of document.querySelectorAll('[data-nav]')) {
  const destination = new URL(link.href);
  if (destination.pathname === location.pathname && destination.search === location.search)
    link.setAttribute('aria-current', 'page');
}
document.addEventListener('click', event => {
  for (const profile of document.querySelectorAll('.profile[open]'))
    if (!profile.contains(event.target)) profile.open = false;
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const profile = document.querySelector('.profile[open]');
  if (profile) { profile.open = false; profile.querySelector('summary').focus(); }
  if (nav?.classList.contains('open')) {
    nav.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus();
  }
});
if (toggle)
  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    nav.classList.toggle("open", !expanded);
  });
for (const input of document.querySelectorAll("input[data-preview]")) {
  let urls = [];
  input.addEventListener("change", () => {
    urls.forEach(URL.revokeObjectURL);
    urls = [];
    const container = document.getElementById(input.dataset.preview);
    container.replaceChildren();
    for (const file of input.files) {
      const tile = document.createElement("span");
      const name = document.createElement("small");
      name.textContent = file.name;
      if (["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        const img = document.createElement("img");
        img.alt = file.name + " — selected, not yet uploaded";
        const url = URL.createObjectURL(file);
        urls.push(url);
        img.src = url;
        tile.append(img);
      }
      tile.append(name);
      container.append(tile);
    }
  });
}
for (const form of document.querySelectorAll(".property-upload,.upload-form"))
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = form.querySelector(".upload-status");
    const buttons = [
      ...form.querySelectorAll("button[type=submit],button:not([type]),[data-step-target],[data-step-back],[data-step-next]"),
    ];
    const data = new FormData(form);
    if (event.submitter?.name)
      data.set(event.submitter.name, event.submitter.value);
    if (form.classList.contains("property-upload") && !data.has("intent"))
      data.set("intent", "submit");
    if (form.classList.contains("property-upload") && data.get("intent") !== "draft") {
      const description = form.elements.namedItem("description");
      if (description.value.trim().split(/\s+/).filter(Boolean).length < 12) {
        status.textContent = "Add a description of at least 80 characters and 12 words before submitting to admin.";
        description.focus();
        return;
      }
    }
    const files = [...data.values()].filter(
      (v) => v instanceof File && v.size > 0,
    );
    if (files.some((f) => f.size > 4 * 1024 * 1024)) {
      status.textContent =
        "Each uploaded photo or document must be no larger than 4 MB.";
      return;
    }
    if(files.reduce((total,file)=>total+file.size,0)>23*1024*1024){status.textContent='Keep each upload batch below 23 MB. Add the remaining photos in another save.';return;}
    const photoFiles = [...data.entries()]
      .filter(
        ([key, value]) =>
          value instanceof File &&
          value.size > 0 &&
          key !== "authorizationFiles",
      )
      .map(([, value]) => value);
    const documentFiles = [...data.entries()]
      .filter(
        ([key, value]) =>
          key === "authorizationFiles" &&
          value instanceof File &&
          value.size > 0,
      )
      .map(([, value]) => value);
    if (
      photoFiles.some(
        (file) =>
          !["image/jpeg", "image/png", "image/webp"].includes(file.type),
      )
    ) {
      status.textContent = "Choose JPEG, PNG or WebP photographs.";
      return;
    }
    if (
      documentFiles.some(
        (file) =>
          ![
            "application/pdf",
            "image/jpeg",
            "image/png",
            "image/webp",
          ].includes(file.type),
      )
    ) {
      status.textContent =
        "Authorization documents must be PDF, JPEG, PNG or WebP.";
      return;
    }
    if (
      form.classList.contains("property-upload") &&
      photoFiles.length + Number(form.dataset.existing) > 12
    ) {
      status.textContent = "Maximum 12 property photographs in total.";
      return;
    }
    if (
      documentFiles.length + Number(form.dataset.existingDocuments || 0) >
      3
    ) {
      status.textContent =
        "Maximum 3 authorization documents in total. Remove an old document before replacing it.";
      return;
    }
    buttons.forEach((b) => (b.disabled = true));
    status.textContent = files.length
      ? "Saving your PG and preparing " + files.length + " file(s)…"
      : "Saving your PG…";
    try {
      const response = await fetch(form.action, {
        method: "POST",
        headers: {
          "x-csrf-token": form.dataset.token,
          Accept: "application/json",
        },
        body: data,
      });
      if (response.headers.get("content-type")?.includes("application/json")) {
        const result = await response.json();
        if (result.redirectTo && (response.ok || response.status === 422)) {
          window.location.assign(result.redirectTo);
          return;
        }
        status.textContent =
          result.message ||
          "The PG was not submitted. Please check the details and try again.";
        status.scrollIntoView({ block: "center", behavior: "auto" });
        return;
      }
      if (response.ok && response.redirected) {
        window.location.assign(response.url);
        return;
      }
      const text = await response.text();
      const doc = new DOMParser().parseFromString(text, "text/html");
      status.textContent =
        doc.querySelector("[role=alert]")?.textContent ||
        "The action could not be completed. Your entries are still here; please check them and try again.";
      status.scrollIntoView({ block: "center", behavior: "auto" });
    } catch (error) {
      status.textContent =
        "Connection interrupted. Your entries are still here. Check your dashboard before retrying.";
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  });
const viewer = document.querySelector(".photo-viewer");
const photos = [...document.querySelectorAll(".gallery-photo")];
if (viewer && photos.length) {
  let current = 0;
  const display = (index) => {
    current = (index + photos.length) % photos.length;
    const photo = photos[current];
    const image = viewer.querySelector(".viewer-image");
    image.src = photo.href;
    image.alt = photo.dataset.caption;
    viewer.querySelector(".viewer-caption").textContent = photo.dataset.caption;
    viewer.querySelector(".viewer-counter").textContent =
      "Photo " + (current + 1) + " of " + photos.length;
  };
  photos.forEach((photo, index) =>
    photo.addEventListener("click", (event) => {
      event.preventDefault();
      display(index);
      viewer.showModal();
    }),
  );
  viewer
    .querySelector(".viewer-close")
    .addEventListener("click", () => viewer.close());
  viewer
    .querySelector(".viewer-previous")
    .addEventListener("click", () => display(current - 1));
  viewer
    .querySelector(".viewer-next")
    .addEventListener("click", () => display(current + 1));
  viewer.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      display(current - 1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      display(current + 1);
    }
  });
}

// Keep mobile results visible; native details keeps filters usable without JavaScript.
const searchFilters = document.querySelector('.filter-disclosure');
if (searchFilters && window.matchMedia('(max-width: 800px)').matches) {
  searchFilters.open = false;
}

// Email tokens stay in the URL fragment and are removed before any navigation.
for(const form of document.querySelectorAll('[data-token-form]')){
 const token=new URLSearchParams(location.hash.slice(1)).get('token')||'';
 history.replaceState(null,'',location.pathname);
 const field=form.querySelector('[name="token"]');field.value=token;
 const valid=/^[a-f0-9]{64}$/.test(token);
 form.querySelector('button').disabled=!valid;
 form.querySelector('[data-token-status]').textContent=valid?'Your one-time link is ready. Confirm below.':'This link is missing its verification token. Open the full email link or request another.';
}
