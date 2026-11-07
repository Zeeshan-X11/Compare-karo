const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
process.env.MONGOMS_DOWNLOAD_DIR = path.resolve(
  __dirname,
  "../../work/mongodb-binaries",
);
process.env.UPLOAD_DIR = path.resolve(__dirname, "../../work/test-uploads");
const { MongoMemoryServer } = require("mongodb-memory-server"),
  mongoose = require("mongoose"),
  request = require("supertest"),
  sharp = require("sharp");
const { createApp } = require("../app");
const Listing = require("../models/listing"),
  User = require("../models/user"),
  Inquiry = require("../models/inquiry");
const { filters } = require("../lib/filters");
const { parse: parseProperty } = require("../lib/input");
let mongo, app, server, owner, other, guest, admin, id, imageName;
async function token(agent, url = "/") {
  const r = await agent.get(url);
  const m = r.text.match(/name="_csrf" value="([^"]+)"/);
  if (m) return m[1];
  const login = await agent.get("/login");
  return login.text.match(/name="_csrf" value="([^"]+)"/)[1];
}
async function post(agent, url, data) {
  const csrf = await token(agent);
  return agent
    .post(url)
    .type("form")
    .send({ _csrf: csrf, ...data });
}
const details = {
  name: "FICTIONAL TEST PROPERTY — NOT REAL",
  description:
    "Automated test fixture, not a real PG and never production inventory. This isolated record exercises property validation, rent details, private document review and account permissions in a disposable test database.",
  locality: "Rajanukunte",
  address: "TEST ONLY — NOT A REAL ADDRESS",
  monthlyRent: "12000",
  rentSingle: "12000",
  rentDouble: "12000",
  roomsTotalSingle: "3",
  roomsAvailableSingle: "1",
  roomsTotalDouble: "5",
  roomsAvailableDouble: "2",
  oneTimeFee: "500",
  securityDeposit: "20000",
  propertyCategory: "Men",
  sharingOptions: ["Single", "Double"],
  amenities: ["Wi-Fi", "Laundry"],
  foodOptions: ["Breakfast"],
  contactName: "Test Owner",
  contactPhone: "9876501234",
  ownerAuthorized: "yes",
  availabilityStatus: "unknown",
};
before(
  async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    app = createApp({ memorySession: true, actionLimit: 200, documentScanner:async()=>({status:"clean",engine:"TEST-ONLY",scannedAt:new Date()}) });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    owner = request.agent(server);
    other = request.agent(server);
    guest = request.agent(server);
    admin = request.agent(server);
    for (const [agent, name, role] of [
      [owner, "owner", "owner"],
      [other, "other", "owner"],
      [guest, "guest", "user"],
      [admin, "admin", "user"],
    ]) {
      const r = await post(agent, "/signup", {
        name,
        email: name + "@example.test",
        password: "long-test-password-123",
        role,
      });
      assert.equal(r.status, 302);
    }
    await User.updateOne(
      { email: "admin@example.test" },
      { $set: { role: "admin" } },
    );
  },
  { timeout: 240000 },
);
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});
test("incomplete saved PGs are discoverable by admins and become public only after completion and approval", async () => {
  const png = await sharp({create:{width:32,height:32,channels:3,background:'#ddd'}}).png().toBuffer();
  let req=owner.post('/owner').set('x-csrf-token',await token(owner)).set('Accept','application/json');
  for(const [key,value]of Object.entries({...details,name:'TEST ONLY — three missing essentials',description:'',locality:'',propertyCategory:''})) req=req.field(key,value);
  const created=await req.field('intent','submit').field('photoRights','yes').field('authorizationDeclaration','yes').field('authorizationType','Trade licence')
    .attach('buildingPhoto',png,{filename:'TEST-ONLY-building.png',contentType:'image/png'})
    .attach('authorizationFiles',png,{filename:'TEST-ONLY-evidence.png',contentType:'image/png'});
  assert.equal(created.status,422,created.text);
  assert.deepEqual(created.body.issues,['Description','Locality','PG category']);
  const property=created.body.id;
  assert.doesNotMatch((await admin.get('/admin')).text,/TEST ONLY — three missing essentials/);
  const drafts=await admin.get('/admin?view=drafts');
  assert.equal(drafts.status,200);assert.match(drafts.text,/TEST ONLY — three missing essentials/);
  assert.match((await admin.get('/admin?view=all')).text,/TEST ONLY — three missing essentials/);
  assert.match((await admin.get('/admin/'+property)).text,/Saved draft — not submitted for approval/);
  assert.equal((await guest.get('/admin?view=drafts')).status,403);
  assert.match((await guest.get('/owner')).text,/registered as a Student \/ seeker/);
  const editor=await owner.get('/owner/'+property+'/edit');
  assert.match(editor.text,/has NOT been sent to admin/);
  assert.match(editor.text,/name="description" required minlength="80"/);
  assert.match(editor.text,/name="locality" required/);
  assert.match(editor.text,/name="propertyCategory" required/);
  assert.match(editor.text,/value="draft" formnovalidate/);
  assert.equal((await post(admin,'/admin/'+property,{action:'approve',reviewed:'yes',authorizationReviewed:'yes'})).status,400);
  assert.equal((await guest.get('/listings/'+property)).status,404);
  const completed=await owner.post('/owner/'+property).set('Accept','application/json').type('form').send({_csrf:await token(owner),...details,name:'TEST ONLY — completed essentials',intent:'submit'});
  assert.equal(completed.status,200,completed.text);assert.equal(completed.body.status,'submitted');
  assert.equal((await Listing.findById(property)).images.length,1);
  assert.equal((await Listing.findById(property)).authorizationDocuments.length,1);
  assert.match((await admin.get('/admin')).text,/TEST ONLY — completed essentials/);
  assert.doesNotMatch((await admin.get('/admin?view=drafts')).text,/TEST ONLY — completed essentials/);
  assert.equal((await post(admin,'/admin/'+property,{action:'approve',reviewed:'yes',authorizationReviewed:'yes'})).status,302);
  assert.match((await guest.get('/listings/'+property)).text,/TEST ONLY — completed essentials/);
  assert.match((await guest.get('/listings')).text,/TEST ONLY — completed essentials/);
  assert.equal((await guest.get('/media/'+(await Listing.findById(property)).images[0].filename)).status,200);
  // The empty-homepage test below requires no public inventory at its start.
  await Listing.updateOne({_id:property},{$set:{publicHidden:true}});
});

test("empty homepage, navbar and search render without fake photos", async () => {
  const r = await request(server).get("/");
  assert.equal(r.status, 200);
  assert.match(r.text, /We're onboarding trusted local PGs/);
  assert.match(r.text, /aria-controls="navigation"/);
  assert.doesNotMatch(r.text, /unsplash|images.unsplash/);
  assert.equal((await request(server).get("/listings")).status, 200);
});
test("query filters whitelist values and reject operators", () => {
  const f = filters({
    area: "Rajanukunte",
    minRent: "5000",
    maxRent: "14000",
    sharing: "Double",
    category: "Men",
    amenity: ["Wi-Fi", "Laundry"],
    food: "yes",
  });
  assert.equal(f.query.listingStatus, "published");
  assert.equal(f.query.$or[0].roomOptions.$elemMatch.monthlyRent.$gte, 5000);
  assert.equal(f.query.sharingOptions, "Double");
  assert.deepEqual(f.query.amenities, { $all: ["Wi-Fi", "Laundry"] });
  assert.throws(() => filters({ minRent: "{$gt:0}" }));
  assert.throws(() => filters({ minRent: "20", maxRent: "10" }));
  assert.equal(filters({ area: { $ne: null } }).query.locality, "Rajanukunte");
  assert.equal(filters({ area: " Rajanukunte " }).query.locality, "Rajanukunte");
  assert.equal(parseProperty({ locality: "Rajanukunte" }).locality, "Rajanukunte");
  assert.throws(() => parseProperty({ locality: "Unsupported test locality" }), { status: 400 });
  assert.equal(new Listing({ locality: "Rajanukunte" }).validateSync(), undefined);
  assert.equal(new Listing({ locality: "Unsupported test locality" }).validateSync().errors.locality.kind, "enum");
});
test("CSRF and server role protection", async () => {
  assert.equal(
    (await owner.post("/owner").type("form").send(details)).status,
    403,
  );
  assert.equal((await guest.get("/admin")).status, 403);
  assert.equal((await owner.get("/admin")).status, 403);
  assert.equal((await guest.get("/owner")).status, 403);
  assert.equal((await request(server).get("/owner")).status, 302);
});
test("owner saves draft and private drafts are hidden", async () => {
  const r = await post(owner, "/owner", details);
  assert.equal(r.status, 302);
  id = r.headers.location.split("/")[2];
  assert.equal((await owner.get(r.headers.location)).status, 200);
  assert.equal((await request(server).get("/listings/" + id)).status, 404);
  assert.equal((await other.get("/owner/" + id + "/edit")).status, 403);
  assert.equal(
    (await post(other, "/owner/" + id, { ...details, name: "tamper" })).status,
    403,
  );
  assert.equal((await Listing.findById(id)).name, details.name);
  assert.equal(
    (
      await owner
        .post("/listings")
        .type("form")
        .send({ _csrf: await token(owner) })
    ).status,
    404,
  );
});
test("upload rejects missing rights, invalid content, oversized files; re-encodes genuine input", async () => {
  const image = await sharp({
    create: { width: 40, height: 40, channels: 3, background: "#fff" },
  })
    .jpeg()
    .toBuffer();
  const endpoint = "/owner/" + id + "/photos";
  let r = await owner
    .post(endpoint)
    .set("x-csrf-token", await token(owner))
    .field("type", "Exterior")
    .attach("photo", image, {
      filename: "test.jpg",
      contentType: "image/jpeg",
    });
  assert.equal(r.status, 400);
  r = await owner
    .post(endpoint)
    .set("x-csrf-token", await token(owner))
    .field("type", "Exterior")
    .field("rights", "yes")
    .attach("photo", Buffer.from("not an image"), {
      filename: "fake.jpg",
      contentType: "image/jpeg",
    });
  assert.equal(r.status, 400);
  r = await owner
    .post(endpoint)
    .set("x-csrf-token", await token(owner))
    .field("type", "Exterior")
    .field("rights", "yes")
    .attach("photo", Buffer.alloc(8 * 1024 * 1024 + 1), {
      filename: "large.jpg",
      contentType: "image/jpeg",
    });
  assert.equal(r.status, 400);
  r = await owner
    .post(endpoint)
    .set("x-csrf-token", await token(owner))
    .field("type", "Exterior")
    .field("rights", "yes")
    .attach("photo", image, {
      filename: "test.jpg",
      contentType: "image/jpeg",
    });
  assert.equal(r.status, 302);
  const l = await Listing.findById(id);
  imageName = l.images[0].filename;
  assert.equal(l.images[0].rightsDeclared, true);
  assert.equal((await request(server).get("/media/" + imageName)).status, 404);
  assert.equal((await owner.get("/media/" + imageName)).status, 200);
});
test("owner can attach a private authorization scan before submission", async () => {
  const image = await sharp({
    create: { width: 40, height: 40, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();
  const csrf = await token(owner);
  let req = owner.post("/owner/" + id).set("x-csrf-token", csrf);
  for (const [key, value] of Object.entries(details))
    req = req.field(key, value);
  const r = await req
    .field("intent", "draft")
    .field("authorizationDeclaration", "yes")
    .field("authorizationType", "Trade licence")
    .field("authorizationIssuer", "TEST ONLY issuer")
    .field("authorizationReference", "PRIVATE-TEST-REFERENCE")
    .attach("authorizationFiles", image, {
      filename: "TEST-ONLY-authorization.png",
      contentType: "image/png",
    });
  assert.equal(r.status, 302, r.text);
  const l = await Listing.findById(id);
  assert.equal(l.authorizationDocuments.length, 1);
  assert.equal(l.authorizationDocuments[0].status, "pending");
});
test("admin approval immediately publishes a reviewed submission", async () => {
  assert.equal((await post(owner, "/owner/" + id + "/submit", {})).status, 302);
  assert.equal((await admin.get("/admin")).status, 200);
  assert.equal((await admin.get("/admin/" + id)).status, 200);
  assert.equal(
    (await post(owner, "/admin/" + id, { action: "publish" })).status,
    403,
  );
  assert.equal(
    (await post(admin, "/admin/" + id, { action: "publish" })).status,
    400,
  );
  assert.equal(
    (
      await post(admin, "/admin/" + id, {
        action: "approve",
        reviewed: "yes",
        authorizationReviewed: "yes",
      })
    ).status,
    302,
  );
  assert.equal((await Listing.findById(id)).listingStatus, "published");
  const detail = await request(server).get("/listings/" + id);
  assert.equal(detail.status, 200);
  assert.match(detail.text, /Prices and room availability may change/);
  assert.doesNotMatch(detail.text, /0000000000/);
  assert.equal((await request(server).get("/media/" + imageName)).status, 200);
});
test("real database filtering and sorting for published inventory only", async () => {
  for (const [q, count] of [
    ["area=Rajanukunte", 1],
    ["area=Rajajinagar", 0],
    ["minRent=13000", 0],
    ["maxRent=13000", 1],
    ["sharing=Triple", 0],
    ["sharing=Double", 1],
    ["amenity=Wi-Fi&food=yes", 1],
    ["amenity=Parking", 0],
    ["category=Women", 0],
    ["sort=rent-asc", 1],
    ["sort=rent-desc", 1],
  ]) {
    const r = await request(server).get("/listings?" + q);
    assert.equal(r.status, 200, q);
    assert.equal(r.text.includes(details.name), count === 1, q);
  }
  assert.equal(
    (await request(server).get("/listings?minRent=bad")).status,
    400,
  );
  await Listing.create({
    title: "Legacy holiday sample",
    image: "https://example.com/not-authorized.jpg",
  });
  assert.doesNotMatch(
    (await request(server).get("/listings")).text,
    /Legacy holiday sample/,
  );
});
test("inquiry history, owner inbox, status and privacy", async () => {
  assert.equal(
    (
      await post(guest, "/listings/" + id + "/inquiries", {
        message: "I would like to arrange a visit.",
      })
    ).status,
    302,
  );
  assert.equal(await Inquiry.countDocuments(), 1);
  const properties = await owner.get("/owner");
  assert.equal(properties.status, 200);
  assert.match(properties.text, /<h1>My properties<\/h1>/);
  assert.match(properties.text, /Recorded views:/);
  assert.doesNotMatch(properties.text, /guest@example.test|name="reply"|action="\/inquiries\/[^"]+\/status"/);
  const r = await owner.get("/owner?tab=inquiries");
  assert.equal(r.status, 200);
  assert.match(r.text, /<h1>Inquiry inbox<\/h1>/);
  assert.match(r.text, /guest@example.test/);
  assert.match(r.text, /name="tab" value="inquiries"/);
  assert.match(r.text, /name="reply"/);
  assert.doesNotMatch(r.text, /My PG listings|Listing approval process|Recorded views:/);
  assert.match((await guest.get("/inquiries")).text, /arrange a visit/);
  const otherInbox = await other.get("/owner?tab=inquiries");
  assert.equal(otherInbox.status, 200);
  assert.doesNotMatch(otherInbox.text, /guest@example.test|arrange a visit/);
  const i = await Inquiry.findOne();
  assert.equal(
    (await post(other, "/inquiries/" + i._id + "/status", { status: "closed" }))
      .status,
    404,
  );
  const updated = await post(owner, "/inquiries/" + i._id + "/status", {
    status: "contacted",
  });
  assert.equal(updated.status, 302);
  const destination = new URL(updated.headers.location, "http://localhost");
  assert.equal(destination.pathname, "/owner");
  assert.equal(destination.searchParams.get("tab"), "inquiries");
  assert.equal((await Inquiry.findById(i._id)).status, "contacted");
});
test("reports reach admin; approved listing and photos remain visible during pending edits", async () => {
  assert.equal(
    (
      await post(guest, "/listings/" + id + "/report", {
        message: "Please check these property details.",
      })
    ).status,
    200,
  );
  assert.match(
    (await admin.get("/admin/" + id)).text,
    /Please check these property details/,
  );
  assert.equal((await post(owner, "/owner/" + id, details)).status, 302);
  assert.equal((await request(server).get("/listings/" + id)).status, 200);
  assert.equal((await request(server).get("/media/" + imageName)).status, 200);
  await Listing.updateOne({ _id: id }, { $set: { listingStatus: "rejected" } });
  assert.equal((await request(server).get("/listings/" + id)).status, 200);
});
test("static assets and informational pages render", async () => {
  for (const p of [
    "/styles.css",
    "/app.js",
    "/about",
    "/contact",
    "/privacy",
    "/terms",
    "/health",
  ])
    assert.equal((await request(server).get(p)).status, 200, p);
  assert.equal((await request(server).get("/listings/not-an-id")).status, 404);
});

test("pagination and sorting operate across multiple database records", async () => {
  const ownerUser = await User.findOne({ email: "owner@example.test" });
  const records = Array.from({ length: 14 }, (_, i) => ({
    ...details,
    name: "TEST ONLY PAGINATION " + String(i).padStart(2, "0"),
    monthlyRent: 2000 + i * 100,
    ownerId: ownerUser._id,
    foodIncluded: i === 0,
    listingStatus: "published",
    publicationPolicyVersion: 2,
  }));
  const created = await Listing.insertMany(records);
  try {
    let r = await request(server).get("/listings?sort=rent-asc");
    assert.equal(r.status, 200);
    assert.match(r.text, /TEST ONLY PAGINATION 00/);
    assert.doesNotMatch(r.text, /TEST ONLY PAGINATION 12/);
    assert.match(r.text, /Page 1 of 2/);
    r = await request(server).get("/listings?sort=rent-asc&page=2");
    assert.match(r.text, /TEST ONLY PAGINATION 12/);
    assert.doesNotMatch(r.text, /TEST ONLY PAGINATION 00/);
    r = await request(server).get("/listings?sort=rent-desc");
    assert.ok(
      r.text.indexOf("TEST ONLY PAGINATION 13") <
        r.text.indexOf("TEST ONLY PAGINATION 12"),
    );
    r = await request(server).get("/listings?foodIncluded=yes");
    assert.match(r.text, /TEST ONLY PAGINATION 00/);
    assert.doesNotMatch(r.text, /TEST ONLY PAGINATION 01/);
  } finally {
    await Listing.deleteMany({ _id: { $in: created.map((l) => l._id) } });
  }
});
test("login rotates session and logout revokes access", async () => {
  const agent = request.agent(server);
  let r = await post(agent, "/login", {
    email: "owner@example.test",
    password: "wrong-password-123",
  });
  assert.equal(r.status, 400);
  r = await post(agent, "/login", {
    email: "owner@example.test",
    password: "long-test-password-123",
  });
  assert.equal(r.status, 302);
  assert.equal((await agent.get("/owner")).status, 200);
  assert.equal((await post(agent, "/logout", {})).status, 302);
  assert.equal((await agent.get("/owner")).status, 302);
});
test("owner cannot inject admin approval or coordinates through a form", async () => {
  const r = await post(owner, "/owner/" + id, {
    ...details,
    listingStatus: "published",
    intent: "draft",
    ownerIdentityStatus: "verified",
    coordinates: "fake",
    ownerId: (
      await User.findOne({ email: "other@example.test" })
    )._id.toString(),
    foodIncluded: "yes",
  });
  assert.equal(r.status, 302);
  const l = await Listing.findById(id);
  assert.equal(l.listingStatus, "draft");
  assert.equal(l.ownerIdentityStatus, "unverified");
  assert.equal(l.foodIncluded, true);
  assert.equal(l.coordinates.verified, false);
  assert.equal(
    String(l.ownerId),
    String((await User.findOne({ email: "owner@example.test" }))._id),
  );
});

test("student accounts keep their role and cannot open or self-enable owner tools", async () => {
  assert.equal((await request(server).get("/list-property")).status, 200);
  const form = await request(server).get("/signup?role=owner&next=/owner/new");
  assert.match(form.text, /value="owner" selected/);
  for (const url of ["/owner", "/owner/new", "/listings/new"])
    assert.equal((await guest.get(url)).status, 403, url);
  assert.equal((await post(guest, "/owner/start", {})).status, 403);
  assert.equal(
    (await post(guest, "/owner/start", { role: "owner" })).status,
    403,
  );
  assert.equal(
    (
      await post(guest, "/owner", {
        ...details,
        role: "owner",
        intent: "draft",
      })
    ).status,
    403,
  );
  assert.equal(
    (await User.findOne({ email: "guest@example.test" })).role,
    "user",
  );
  for (const url of ["/", "/listings", "/about", "/account"]) {
    const r = await guest.get(url);
    assert.equal(r.status, 200, url);
    assert.doesNotMatch(
      r.text,
      /href="\/list-property"|href="\/owner"|action="\/owner\/start"/,
      url,
    );
  }
  const studentTools = ["/favorites", "/compare", "/inquiries", "/reports"];
  const ownerTools = ["/owner", "/owner?tab=inquiries", "/owner/new"];
  const adminTools = ["/admin", "/admin/owners", "/admin/audit"];
  for (const [label, agent, visible, absent] of [
    ["student", guest, ["/listings", ...studentTools], ["/list-property", ...ownerTools, ...adminTools]],
    ["owner", owner, ownerTools, [...studentTools, ...adminTools]],
    ["admin", admin, adminTools, studentTools],
  ]) {
    const account = await agent.get("/account");
    assert.equal(account.status, 200, label);
    const header = account.text.match(/<header class="nav">([\s\S]*?)<\/header>/)?.[1];
    assert.ok(header, label + " header");
    const links = new Set([...header.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((match) => match[1]));
    for (const href of visible) assert.ok(links.has(href), label + " shows " + href);
    for (const href of absent) assert.ok(!links.has(href), label + " does not show " + href);
  }
  assert.doesNotMatch(
    (await guest.get("/list-property")).text,
    /action="\/owner\/start"/,
  );
});
test("new listing form offers main building and multiple gallery photos immediately", async () => {
  const r = await owner.get("/owner/new");
  assert.equal(r.status, 200);
  assert.match(r.text, /name="buildingPhoto"/);
  assert.match(r.text, /name="galleryPhotos"[^>]*multiple/);
  assert.match(r.text, /Submit PG for admin approval/);
  assert.ok(r.text.indexOf('value="submit"') < r.text.indexOf('value="draft"'));
});
test("create PG with building and room photos, admin approves, cover and full gallery are public", async () => {
  const image = await sharp({
    create: { width: 48, height: 48, channels: 3, background: "#ccddee" },
  })
    .png()
    .toBuffer();
  const csrf = await token(owner);
  let req = owner.post("/owner").set("x-csrf-token", csrf);
  for (const [key, value] of Object.entries(details))
    req = req.field(key, value);
  const r = await req
    .field("intent", "submit")
    .field("photoRights", "yes")
    .field("authorizationDeclaration", "yes")
    .field("authorizationType", "Trade licence")
    .attach("authorizationFiles", image, {
      filename: "TEST-ONLY-authorization.png",
      contentType: "image/png",
    })
    .attach("buildingPhoto", image, {
      filename: "TEST-ONLY-exterior.png",
      contentType: "image/png",
    })
    .attach("galleryPhotos", image, {
      filename: "TEST-ONLY-room.png",
      contentType: "image/png",
    })
    .attach("galleryPhotos", image, {
      filename: "TEST-ONLY-bathroom.png",
      contentType: "image/png",
    });
  assert.equal(r.status, 302, r.text);
  assert.equal(r.headers.location, "/owner?submitted=1");
  const listing = await Listing.findOne({
    ownerId: (await User.findOne({ email: "owner@example.test" }))._id,
    listingStatus: "submitted",
  });
  assert.ok(listing);
  assert.equal(listing.images.length, 3);
  assert.equal(listing.images[0].type, "Exterior");
  assert.equal(
    (await request(server).get("/listings/" + listing._id)).status,
    404,
  );
  assert.equal(
    (await request(server).get("/media/" + listing.images[1].filename)).status,
    404,
  );
  assert.equal(
    (
      await post(admin, "/admin/" + listing._id, {
        action: "approve",
        reviewed: "yes",
        authorizationReviewed: "yes",
      })
    ).status,
    302,
  );
  const cards = await request(server).get("/listings");
  assert.match(
    cards.text,
    new RegExp('src="/media/' + (listing.images[0].thumbnail||listing.images[0].filename) + '"'),
  );
  assert.doesNotMatch(
    cards.text,
    new RegExp('src="/media/' + listing.images[1].filename + '"'),
  );
  const page = await request(server).get("/listings/" + listing._id);
  assert.equal(page.status, 200);
  for (const photo of listing.images) {
    assert.ok(page.text.includes("/media/" + photo.filename));
    assert.equal(
      (await request(server).get("/media/" + photo.filename)).status,
      200,
    );
  }
  assert.match(page.text, /photo-viewer/);
  assert.match(page.text, /viewer-next/);
  assert.match(page.text, /Security deposit/);
  assert.match(page.text, /Wi-Fi/);
  assert.match(
    (await request(server).get("/")).text,
    new RegExp(listing.images[0].thumbnail||listing.images[0].filename),
  );
});
test("incomplete submissions persist a private draft and invalid images do not create inventory", async () => {
  const before = await Listing.countDocuments();
  let r = await post(owner, "/owner", { ...details, intent: "submit" });
  assert.equal(r.status, 302);
  assert.match(r.headers.location, /incomplete=1/);
  assert.match(
    (await owner.get(r.headers.location)).text,
    /has NOT been sent to admin/,
  );
  assert.equal(await Listing.countDocuments(), before + 1);
  const csrf = await token(owner);
  r = await owner
    .post("/owner")
    .set("x-csrf-token", csrf)
    .field("name", "UNSAVED TEST")
    .field("photoRights", "yes")
    .attach("buildingPhoto", Buffer.from("invalid"), {
      filename: "bad.png",
      contentType: "image/png",
    });
  assert.equal(r.status, 400);
  assert.equal(await Listing.countDocuments(), before + 1);
});
test("cover selects an approved exterior even when a room was uploaded first", () => {
  const { coverPhoto } = require("../lib/photos");
  const room = { _id: "1", type: "Interior", status: "approved" },
    building = { _id: "2", type: "Exterior", status: "approved" },
    pending = { _id: "3", type: "Exterior", status: "pending" };
  assert.equal(coverPhoto({ images: [room, pending, building] }), building);
  assert.equal(coverPhoto({ images: [room, pending] }), null);
});

test("admin can list a PG through owner tools without bypassing review or editing other owners", async () => {
  assert.equal((await admin.get("/owner/new")).status, 200);
  assert.equal(
    (await admin.get("/list-property")).headers.location,
    "/owner/new",
  );
  const r = await post(admin, "/owner", {
    ...details,
    listingStatus: "published",
  });
  assert.equal(r.status, 302);
  const newId = r.headers.location.split("/")[2];
  const l = await Listing.findById(newId);
  assert.equal(l.listingStatus, "draft");
  assert.equal((await request(server).get("/listings/" + newId)).status, 404);
  assert.equal((await admin.get("/owner/" + id + "/edit")).status, 403);
});

test("default multipart Rajanukunte submission reaches admin queue and only approval makes it visible in the area search", async () => {
  const image = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#ddd" },
  })
    .webp()
    .toBuffer();
  const csrf = await token(owner);
  let req = owner
    .post("/owner")
    .set("x-csrf-token", csrf)
    .set("Accept", "application/json");
  for (const [key, value] of Object.entries({
    ...details,
    name: "TEST ONLY — pending to public regression",
    locality: "Rajanukunte",
  }))
    req = req.field(key, value);
  const result = await req
    .field("photoRights", "yes")
    .field("authorizationDeclaration", "yes")
    .field("authorizationType", "Trade licence")
    .attach("authorizationFiles", image, {
      filename: "TEST-ONLY-authorization.webp",
      contentType: "image/webp",
    })
    .attach("buildingPhoto", image, {
      filename: "TEST-ONLY-building.webp",
      contentType: "image/webp",
    });
  assert.equal(result.status, 200, result.text);
  assert.equal(result.body.status, "submitted");
  const listing = await Listing.findById(result.body.id);
  assert.ok(listing.submittedAt);
  assert.equal(listing.locality, "Rajanukunte");
  const queue = await admin.get("/admin");
  assert.match(queue.text, /TEST ONLY — pending to public regression/);
  assert.equal((await guest.get("/listings/" + listing._id)).status, 404);
  assert.doesNotMatch(
    (await guest.get("/listings?area=Rajanukunte")).text,
    /TEST ONLY — pending to public regression/,
  );
  assert.equal(
    (
      await post(admin, "/admin/" + listing._id, {
        action: "approve",
        reviewed: "yes",
        authorizationReviewed: "yes",
      })
    ).status,
    302,
  );
  assert.equal((await guest.get("/listings/" + listing._id)).status, 200);
  assert.match(
    (await guest.get("/listings?area=Rajanukunte")).text,
    /TEST ONLY — pending to public regression/,
  );
  assert.doesNotMatch(
    (await guest.get("/listings?area=Yelahanka")).text,
    /TEST ONLY — pending to public regression/,
  );
  assert.match(
    (await guest.get("/")).text,
    /TEST ONLY — pending to public regression/,
  );
  assert.doesNotMatch(
    (await admin.get("/admin")).text,
    /TEST ONLY — pending to public regression/,
  );
  assert.match(
    (await admin.get("/admin?view=all")).text,
    /TEST ONLY — pending to public regression/,
  );
});
test("JSON submission with missing details saves photos and a private draft with an exact checklist", async () => {
  const image = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#eee" },
  })
    .webp()
    .toBuffer();
  const csrf = await token(owner);
  const r = await owner
    .post("/owner")
    .set("x-csrf-token", csrf)
    .set("Accept", "application/json")
    .field("name", "TEST ONLY — incomplete private draft")
    .field("photoRights", "yes")
    .field("intent", "submit")
    .attach("buildingPhoto", image, {
      filename: "TEST-ONLY-building.webp",
      contentType: "image/webp",
    });
  assert.equal(r.status, 422, r.text);
  assert.equal(r.body.status, "draft");
  assert.ok(r.body.issues.includes("Exact address"));
  const l = await Listing.findById(r.body.id);
  assert.equal(l.images.length, 1);
  assert.equal(
    (await request(server).get("/media/" + l.images[0].filename)).status,
    404,
  );
  assert.doesNotMatch(
    (await admin.get("/admin")).text,
    /TEST ONLY — incomplete private draft/,
  );
  assert.match((await owner.get("/owner")).text, /Draft — not sent to admin/);
});
test("an accidentally converted empty owner account can explicitly return to student; accounts with PGs cannot", async () => {
  assert.equal(
    (await post(other, "/account/student", { confirm: "student" })).status,
    302,
  );
  assert.equal(
    (await User.findOne({ email: "other@example.test" })).role,
    "user",
  );
  assert.equal((await other.get("/owner")).status, 403);
  assert.equal(
    (await post(other, "/owner/start", { role: "owner" })).status,
    403,
  );
  assert.equal(
    (await post(owner, "/account/student", { confirm: "student" })).status,
    409,
  );
  assert.equal(
    (await User.findOne({ email: "owner@example.test" })).role,
    "owner",
  );
});

test("authorization files remain private after publication and are absent from public pages", async () => {
  const l = await Listing.findOne({
    listingStatus: "published",
    "authorizationDocuments.0": { $exists: true },
  });
  assert.ok(l);
  const doc = l.authorizationDocuments[0],
    url = "/listings/" + l._id + "/authorization/" + doc._id;
  assert.equal((await request(server).get(url)).status, 302);
  assert.equal((await guest.get(url)).status, 403);
  assert.equal((await admin.get(url)).status, 200);
  const owningUser = await User.findById(l.ownerId);
  const agent = owningUser.email === "owner@example.test" ? owner : admin;
  const r = await agent.get(url);
  assert.equal(r.status, 200);
  assert.match(r.headers["cache-control"], /no-store/);
  assert.equal(
    (await request(server).get("/media/" + doc.filename)).status,
    404,
  );
  const page = await guest.get("/listings/" + l._id);
  assert.doesNotMatch(page.text, new RegExp(doc.filename));
  assert.doesNotMatch(page.text, /PRIVATE-TEST-REFERENCE/);
});
test("a valid PDF is privately stored; bad PDF and missing declaration are rejected", async () => {
  const { PDFDocument } = require("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const bytes = Buffer.from(await pdf.save());
  let csrf = await token(owner);
  let req = owner.post("/owner").set("x-csrf-token", csrf);
  for (const [key, value] of Object.entries(details))
    req = req.field(key, value);
  let r = await req
    .field("intent", "draft")
    .field("authorizationType", "Permission / NOC")
    .field("authorizationDeclaration", "yes")
    .attach("authorizationFiles", bytes, {
      filename: "TEST-ONLY-authorization.pdf",
      contentType: "application/pdf",
    });
  assert.equal(r.status, 302, r.text);
  const newId = r.headers.location.split("/")[2];
  const l = await Listing.findById(newId);
  assert.equal(l.authorizationDocuments[0].mimeType, "application/pdf");
  r = await owner.get(
    "/listings/" + l._id + "/authorization/" + l.authorizationDocuments[0]._id,
  );
  assert.equal(r.status, 200);
  assert.match(r.headers["content-disposition"], /attachment/);
  assert.match(r.headers["content-security-policy"], /sandbox/);
  for (const invalid of [
    Buffer.from("not a PDF"),
    Buffer.from("%PDF-1.7 invalid"),
  ]) {
    csrf = await token(owner);
    r = await owner
      .post("/owner")
      .set("x-csrf-token", csrf)
      .field("intent", "draft")
      .field("authorizationType", "Trade licence")
      .field("authorizationDeclaration", "yes")
      .attach("authorizationFiles", invalid, {
        filename: "bad.pdf",
        contentType: "application/pdf",
      });
    assert.equal(r.status, 400);
  }
  csrf = await token(owner);
  r = await owner
    .post("/owner")
    .set("x-csrf-token", csrf)
    .field("intent", "draft")
    .field("authorizationType", "Trade licence")
    .attach("authorizationFiles", bytes, {
      filename: "valid.pdf",
      contentType: "application/pdf",
    });
  assert.equal(r.status, 400);
});
test("admin cannot approve a submission without explicit document review", async () => {
  const l = await Listing.findOne({
    "authorizationDocuments.0": { $exists: true },
    listingStatus: "published",
    ownerId: (await User.findOne({ email: "owner@example.test" }))._id,
  });
  await Listing.updateOne(
    { _id: l._id },
    { $set: { listingStatus: "submitted" } },
  );
  const r = await post(admin, "/admin/" + l._id, {
    action: "approve",
    reviewed: "yes",
  });
  assert.equal(r.status, 400);
  assert.match(r.text, /authorization documents/);
  assert.equal((await Listing.findById(l._id)).listingStatus, "submitted");
});

test("another owner cannot access authorization files; pending evidence removal preserves approved public version", async () => {
  const l = await Listing.findOne({
    ownerId: (await User.findOne({ email: "owner@example.test" }))._id,
    "authorizationDocuments.0": { $exists: true },
  });
  const doc = l.authorizationDocuments[0],
    url = "/listings/" + l._id + "/authorization/" + doc._id;
  const stranger = request.agent(server);
  assert.equal(
    (
      await post(stranger, "/signup", {
        name: "Document privacy test",
        email: "document-owner@example.test",
        password: "long-test-password-123",
        role: "owner",
      })
    ).status,
    302,
  );
  assert.equal((await stranger.get(url)).status, 403);
  assert.equal(
    (
      await post(
        stranger,
        "/owner/" + l._id + "/authorization/" + doc._id + "/delete",
        {},
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await post(
        owner,
        "/owner/" + l._id + "/authorization/" + doc._id + "/delete",
        {},
      )
    ).status,
    302,
  );
  assert.equal((await owner.get(url)).status, 200);
  assert.equal((await Listing.findById(l._id)).listingStatus, "draft");
  assert.equal((await guest.get("/listings/" + l._id)).status, 200);
  assert.equal((await guest.get(url)).status, 403);
  assert.equal((await admin.get(url)).status, 200);
});
test("authorization upload size and count limits are enforced", async () => {
  const csrf = await token(owner);
  let r = await owner
    .post("/owner")
    .set("x-csrf-token", csrf)
    .field("authorizationType", "Trade licence")
    .field("authorizationDeclaration", "yes")
    .attach("authorizationFiles", Buffer.alloc(8 * 1024 * 1024 + 1), {
      filename: "too-large.pdf",
      contentType: "application/pdf",
    });
  assert.equal(r.status, 400);
  const image = await sharp({
    create: { width: 20, height: 20, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();
  let req = owner
    .post("/owner")
    .set("x-csrf-token", await token(owner))
    .field("authorizationType", "Trade licence")
    .field("authorizationDeclaration", "yes");
  for (let i = 0; i < 4; i++)
    req = req.attach("authorizationFiles", image, {
      filename: "test-" + i + ".png",
      contentType: "image/png",
    });
  r = await req;
  assert.equal(r.status, 400);
});

let portalId, portalOriginalImage;
async function createPortalPG(name = "TEST ONLY — Portal regression") {
  const image = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#aabbcc" },
  })
    .png()
    .toBuffer();
  const csrf = await token(owner);
  let req = owner
    .post("/owner")
    .set("x-csrf-token", csrf)
    .set("Accept", "application/json");
  for (const [key, value] of Object.entries({
    ...details,
    name,
    rentDouble: "10000",
    contactPublic: "yes",
    whatsappAllowed: "yes",
    coordinateLatitude: "13",
    coordinateLongitude: "77",
    locationPublic: "yes",
  }))
    req = req.field(key, value);
  const r = await req
    .field("photoRights", "yes")
    .field("authorizationDeclaration", "yes")
    .field("authorizationType", "Trade licence")
    .attach("buildingPhoto", image, {
      filename: "TEST-ONLY-exterior.png",
      contentType: "image/png",
    })
    .attach("authorizationFiles", image, {
      filename: "TEST-ONLY-authorization.png",
      contentType: "image/png",
    });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.status, "submitted");
  return r.body.id;
}
test("sharing rents, availability, move-in cost, WhatsApp and reviewed Google Maps use approved data", async () => {
  portalId = await createPortalPG();
  assert.equal((await guest.get("/listings/" + portalId)).status, 404);
  assert.equal(
    (
      await post(admin, "/admin/" + portalId, {
        action: "approve",
        reviewed: "yes",
        authorizationReviewed: "yes",
        locationReviewed: "yes",
      })
    ).status,
    302,
  );
  const l = await Listing.findById(portalId);
  portalOriginalImage = l.images[0].filename;
  assert.equal(l.monthlyRent, 10000);
  assert.equal(
    l.roomOptions.find((r) => r.sharing === "Double").availableRooms,
    2,
  );
  const r = await guest.get("/listings/" + portalId + "?sharing=Double");
  assert.equal(r.status, 200);
  assert.match(r.text, /₹30,500/);
  assert.match(r.text, /WhatsApp owner/);
  assert.match(r.text, /google.com\/maps\/search/);
  assert.match(r.text, /query=13%2C77/);
  assert.match(r.text, /mobile-contact/);
  const whatsapp = await guest.get(
    "/listings/" + portalId + "/contact/whatsapp",
  );
  assert.equal(whatsapp.status, 302);
  assert.match(whatsapp.headers.location, /https:\/\/wa.me\/919876501234/);
  assert.equal((await Listing.findById(portalId)).statistics.contactClicks, 1);
});
test("favorites persist privately and comparison is limited to 3 published PGs", async () => {
  assert.equal(
    (
      await post(guest, "/favorites/" + portalId, {
        action: "add",
        returnTo: "/favorites",
      })
    ).status,
    302,
  );
  assert.match(
    (await guest.get("/favorites")).text,
    /TEST ONLY — Portal regression/,
  );
  assert.ok(
    (await User.findOne({ email: "guest@example.test" })).favorites.some(
      (v) => String(v) === portalId,
    ),
  );
  assert.doesNotMatch(
    (await owner.get("/favorites")).text,
    /TEST ONLY — Portal regression/,
  );
  const ownerId = (await User.findOne({ email: "owner@example.test" }))._id;
  const created = await Listing.insertMany(
    Array.from({ length: 3 }, (_, i) => ({
      ...details,
      ownerId,
      name: "TEST ONLY — Comparison " + i,
      listingStatus: "published",
      publicationPolicyVersion: 2,
      roomOptions: [{ sharing: "Single", monthlyRent: 12000 }],
      contactPhone: "+919876501234",
    })),
  );
  assert.equal(
    (await post(guest, "/compare/" + portalId, { action: "add" })).status,
    302,
  );
  for (const l of created.slice(0, 2))
    assert.equal(
      (await post(guest, "/compare/" + l._id, { action: "add" })).status,
      302,
    );
  assert.equal(
    (await post(guest, "/compare/" + created[2]._id, { action: "add" })).status,
    400,
  );
  assert.match(
    (await guest.get("/compare")).text,
    /TEST ONLY — Portal regression/,
  );
  assert.equal(
    (await post(guest, "/compare/" + created[0]._id, { action: "remove" }))
      .status,
    302,
  );
  assert.equal(
    (await post(guest, "/compare/" + created[2]._id, { action: "add" })).status,
    302,
  );
  assert.equal(
    (await post(guest, "/favorites/" + portalId, { action: "remove" })).status,
    302,
  );
  assert.doesNotMatch(
    (await guest.get("/favorites")).text,
    /TEST ONLY — Portal regression/,
  );
});
test("significant edits, rejection and corrections retain approved data and search prices until approval", async () => {
  const edit = {
    ...details,
    name: "TEST ONLY — Pending changed name",
    rentSingle: "15000",
    rentDouble: "14000",
    contactPublic: "yes",
    whatsappAllowed: "yes",
    intent: "submit",
  };
  assert.equal((await post(owner, "/owner/" + portalId, edit)).status, 302);
  assert.equal((await Listing.findById(portalId)).listingStatus, "submitted");
  let page = await guest.get("/listings/" + portalId);
  assert.match(page.text, /TEST ONLY — Portal regression/);
  assert.doesNotMatch(page.text, /TEST ONLY — Pending changed name/);
  assert.match(
    (await guest.get("/listings?maxRent=11000")).text,
    /TEST ONLY — Portal regression/,
  );
  assert.equal(
    (
      await post(admin, "/admin/" + portalId, {
        action: "corrections",
        notes:
          "Please supply clearer evidence for these changed property details.",
      })
    ).status,
    302,
  );
  assert.equal((await guest.get("/listings/" + portalId)).status, 200);
  assert.match((await owner.get("/owner")).text, /Corrections requested/);
  assert.equal(
    (await post(owner, "/owner/" + portalId + "/submit", {})).status,
    302,
  );
  assert.equal(
    (
      await post(admin, "/admin/" + portalId, {
        action: "reject",
        notes:
          "The proposed revision needs accurate updated property information.",
      })
    ).status,
    302,
  );
  assert.match(
    (await guest.get("/listings/" + portalId)).text,
    /TEST ONLY — Portal regression/,
  );
  assert.equal(
    (await post(owner, "/owner/" + portalId + "/submit", {})).status,
    302,
  );
  assert.equal(
    (
      await post(admin, "/admin/" + portalId, {
        action: "approve",
        reviewed: "yes",
        authorizationReviewed: "yes",
      })
    ).status,
    302,
  );
  page = await guest.get("/listings/" + portalId);
  assert.match(page.text, /TEST ONLY — Pending changed name/);
  assert.doesNotMatch(
    (await guest.get("/listings?maxRent=11000")).text,
    /TEST ONLY — Pending changed name/,
  );
});
test("pending photo removal retains the live cover and pending new images stay private", async () => {
  let l = await Listing.findById(portalId);
  const photo = l.images[0];
  assert.equal(
    (
      await post(
        owner,
        "/owner/" + portalId + "/photos/" + photo._id + "/delete",
        {},
      )
    ).status,
    302,
  );
  assert.equal(
    (await request(server).get("/media/" + portalOriginalImage)).status,
    200,
  );
  assert.match(
    (await guest.get("/listings/" + portalId)).text,
    new RegExp(portalOriginalImage),
  );
  const buffer = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#eee" },
  })
    .png()
    .toBuffer();
  const csrf = await token(owner);
  const r = await owner
    .post("/owner/" + portalId + "/photos")
    .set("x-csrf-token", csrf)
    .field("type", "Exterior")
    .field("rights", "yes")
    .attach("photo", buffer, {
      filename: "TEST-ONLY-new.png",
      contentType: "image/png",
    });
  assert.equal(r.status, 302);
  l = await Listing.findById(portalId);
  const image = l.images[0];
  assert.equal(
    (await request(server).get("/media/" + image.filename)).status,
    404,
  );
  assert.equal((await owner.get("/media/" + image.filename)).status, 200);
  assert.equal(
    (
      await post(
        owner,
        "/owner/" + portalId + "/photos/" + image._id + "/manage",
        { type: "Exterior", cover: "yes" },
      )
    ).status,
    302,
  );
  assert.equal(
    String((await Listing.findById(portalId)).coverImageId),
    String(image._id),
  );
});
test("inquiry replies, visit scheduling and status history are visible only to participants", async () => {
  assert.equal(
    (
      await post(guest, "/listings/" + portalId + "/inquiries", {
        message:
          "TEST ONLY — Can we arrange a visit and confirm the available rooms?",
      })
    ).status,
    302,
  );
  const i = await Inquiry.findOne({ propertyId: portalId });
  const visit = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16);
  assert.equal(
    (
      await post(owner, "/inquiries/" + i._id + "/status", {
        status: "visit_scheduled",
        reply: "TEST ONLY — Your visit can be arranged at the requested time.",
        scheduledVisitAt: visit,
      })
    ).status,
    302,
  );
  const history = await guest.get("/inquiries");
  assert.match(history.text, /Your visit can be arranged/);
  assert.match(history.text, /Visit scheduled/);
  assert.match(history.text, /Inquiry status history/);
  assert.equal((await Inquiry.findById(i._id)).history.length, 1);
  assert.doesNotMatch(
    (await admin.get("/inquiries")).text,
    /Your visit can be arranged/,
  );
});
test("view analytics count a session once and owner/admin views do not inflate counts", async () => {
  const agent = request.agent(server);
  let before = (await Listing.findById(portalId)).statistics.views;
  assert.equal((await agent.get("/listings/" + portalId)).status, 200);
  assert.equal((await agent.get("/listings/" + portalId)).status, 200);
  assert.equal((await Listing.findById(portalId)).statistics.views, before + 1);
  before = (await Listing.findById(portalId)).statistics.views;
  await owner.get("/listings/" + portalId);
  await admin.get("/listings/" + portalId);
  assert.equal((await Listing.findById(portalId)).statistics.views, before);
  assert.match((await owner.get("/owner")).text, /Recorded views/);
});
test("admin verification, report dispositions, owner management and moderation require admin role", async () => {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });
  assert.equal(
    (
      await post(owner, "/admin/" + portalId + "/verification", {
        method: "site-visit",
        notes: "TEST ONLY attempted forbidden evidence record.",
        performedAt: today,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await post(admin, "/admin/" + portalId + "/verification", {
        method: "documents",
        notes:
          "TEST ONLY — Supporting evidence inspected for fixture validation.",
        performedAt: today,
      })
    ).status,
    302,
  );
  assert.equal(
    (await post(owner, "/owner/" + portalId + "/submit", {})).status,
    302,
  );
  assert.equal(
    (
      await post(admin, "/admin/" + portalId, {
        action: "approve",
        reviewed: "yes",
        authorizationReviewed: "yes",
      })
    ).status,
    302,
  );
  let page = await guest.get("/listings/" + portalId);
  assert.match(page.text, /Supporting documents were reviewed/);
  assert.doesNotMatch(page.text, /Supporting evidence inspected/);
  assert.equal(
    (
      await post(guest, "/listings/" + portalId + "/report", {
        message: "TEST ONLY — Please check the advertised price details.",
      })
    ).status,
    200,
  );
  const l = await Listing.findById(portalId);
  const report = l.reports[l.reports.length - 1];
  assert.equal(
    (
      await post(admin, "/admin/" + portalId + "/reports/" + report._id, {
        status: "resolved",
        resolution:
          "TEST ONLY — Reviewed the reported price with the fixture owner.",
      })
    ).status,
    302,
  );
  assert.equal(
    (await Listing.findById(portalId)).reports.id(report._id).status,
    "resolved",
  );
  assert.equal((await guest.get("/admin/owners")).status, 403);
  assert.equal((await admin.get("/admin/owners")).status, 200);
  assert.match((await admin.get("/admin")).text, /Total inquiries/);
});
test("unpublish hides an approved snapshot; only explicit approval restores visibility", async () => {
  assert.equal(
    (
      await post(admin, "/admin/" + portalId, {
        action: "unpublish",
        notes:
          "TEST ONLY — Temporarily withdraw the public listing for review.",
      })
    ).status,
    302,
  );
  assert.equal((await guest.get("/listings/" + portalId)).status, 404);
  assert.equal(
    (await post(owner, "/owner/" + portalId + "/submit", {})).status,
    302,
  );
  assert.equal((await guest.get("/listings/" + portalId)).status, 404);
  assert.equal(
    (
      await post(admin, "/admin/" + portalId, {
        action: "approve",
        reviewed: "yes",
        authorizationReviewed: "yes",
      })
    ).status,
    302,
  );
  assert.equal((await guest.get("/listings/" + portalId)).status, 200);
});
test("owner suspension hides public snapshots and revokes existing authenticated owner access", async () => {
  const ownerUser = await User.findOne({ email: "owner@example.test" });
  assert.equal(
    (
      await post(guest, "/admin/owners/" + ownerUser._id + "/state", {
        action: "suspend",
        reason: "TEST ONLY forbidden suspension attempt.",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await post(admin, "/admin/owners/" + ownerUser._id + "/state", {
        action: "suspend",
        reason: "TEST ONLY — Account restricted for moderation regression.",
      })
    ).status,
    302,
  );
  assert.equal((await guest.get("/listings/" + portalId)).status, 404);
  assert.equal((await owner.get("/owner")).status, 403);
  // The authoritative account check also protects media if a cached listing flag is stale.
  await Listing.updateOne(
    { _id: portalId },
    { $set: { ownerSuspended: false } },
  );
  const suspended = await Listing.findById(portalId);
  assert.equal(
    (await guest.get("/media/" + suspended.publicSnapshot.images[0].filename))
      .status,
    404,
  );
  assert.equal((await guest.get("/listings/" + portalId)).status, 404);
  assert.equal(
    (
      await post(admin, "/admin/owners/" + ownerUser._id + "/state", {
        action: "restore",
        reason: "TEST ONLY — Restore account after moderation regression.",
      })
    ).status,
    302,
  );
  assert.equal((await guest.get("/listings/" + portalId)).status, 200);
  assert.equal(
    (
      await post(owner, "/login", {
        email: "owner@example.test",
        password: "long-test-password-123",
      })
    ).status,
    302,
  );
  assert.equal((await owner.get("/owner")).status, 200);
});
test("validation rejects placeholder phones, implausible rent, bad room counts and incomplete descriptions", () => {
  const { parse, submissionIssues } = require("../lib/input");
  for (const number of ["0000000000", "9999999999", "9876543210", "12345"])
    assert.throws(() => parse({ ...details, contactPhone: number }));
  assert.throws(() =>
    parse({ ...details, monthlyRent: "1", rentSingle: "", rentDouble: "" }),
  );
  assert.throws(() => parse({ ...details, rentSingle: "9999999" }));
  assert.throws(() =>
    parse({ ...details, roomsTotalSingle: "1", roomsAvailableSingle: "2" }),
  );
  const input = parse({ ...details, description: "A room." });
  assert.ok(
    submissionIssues({ ...input, images: [], authorizationDocuments: [] }).some(
      (issue) => issue.includes("description"),
    ),
  );
  assert.equal(
    parse({ ...details, contactPhone: "98765 01234" }).contactPhone,
    "+919876501234",
  );
});

test("sharing-specific search uses that sharing rent, and date-only fields do not drift across timezones", async () => {
  const yes = await guest.get(
    "/listings?sharing=Single&minRent=14500&maxRent=15500",
  );
  assert.equal(yes.status, 200);
  assert.match(yes.text, /Pending changed name/);
  const no = await guest.get(
    "/listings?sharing=Double&minRent=14500&maxRent=15500",
  );
  assert.equal(no.status, 200);
  assert.doesNotMatch(no.text, /Pending changed name/);
  const { dateInput } = require("../lib/marketplace");
  assert.equal(
    dateInput("2025-01-02", "Date").toISOString().slice(0, 10),
    "2025-01-02",
  );
  const { parse } = require("../lib/input");
  assert.equal(parse({ ...details, monthlyRent: "1000" }).monthlyRent, 12000);
});

test("new owner details cannot inherit verification of the previous approved version", async () => {
  const before = await Listing.findById(portalId);
  assert.equal(before.publicSnapshot.verification.method, "documents");
  const response = await post(owner, "/owner/" + portalId, {
    ...details,
    address: "TEST ONLY — changed address for revision validation",
    intent: "submit",
  });
  assert.equal(response.status, 302);
  const pending = await Listing.findById(portalId);
  assert.equal(pending.verification.method, "unverified");
  assert.equal(pending.coordinates.verified, false);
  assert.equal(pending.publicSnapshot.verification.method, "documents");
  const old = await guest.get("/listings/" + portalId);
  assert.match(old.text, /Supporting documents were reviewed/);
  assert.doesNotMatch(old.text, /changed address for revision validation/);
  assert.equal(
    (
      await post(admin, "/admin/" + portalId, {
        action: "approve",
        reviewed: "yes",
        authorizationReviewed: "yes",
      })
    ).status,
    302,
  );
  const current = await guest.get("/listings/" + portalId);
  assert.match(current.text, /changed address for revision validation/);
  assert.doesNotMatch(current.text, /Supporting documents were reviewed/);
});
