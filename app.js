require("dotenv").config();
const express = require("express"),
  mongoose = require("mongoose"),
  path = require("path"),
  crypto = require("crypto");
const session = require("express-session"),
  MongoStore = require("connect-mongo"),
  bcrypt = require("bcryptjs"),
  helmet = require("helmet"),
  multer = require("multer"),
  sharp = require("sharp");
const Listing = require("./models/listing"),
  User = require("./models/user"),
  Inquiry = require("./models/inquiry");
const { photoOrigins } = require("./models/directory-entry");
const { filters, amenities, sharing, scalar } = require("./lib/filters"),
  { parse, publishable, submissionIssues } = require("./lib/input");
const {
  singleUpload,
  propertyUpload,
  coverPhoto,
  submissionError,
  preparePhotos,
  discardPhotos,
} = require("./lib/photos");
const {
  prepareAuthorization,
  discardAuthorization,
  resetAuthorization,
  authorizationTypes,
} = require("./lib/authorization");
const {problem,log}=require('./lib/errors');
const {limiter,uploadGuard}=require('./lib/limits');
const {audit}=require('./lib/audit');
const {createStorage}=require('./lib/storage');
const publication = require("./lib/publication");
const market = require("./lib/marketplace");
const { exactLocationUrl } = require("./lib/maps");
const { registerPortalRoutes } = require("./routes/portals");
const { localities } = require('./lib/localities');
const directory = require('./lib/directory');
sharp.cache({ memory: 32, files: 0, items: 50 });
sharp.concurrency(2);
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
function createApp(options = {}) {
  require('./lib/config').validateRuntime();
  const app = express();
  const production = process.env.NODE_ENV === "production";
  const renderReview = require('./lib/admin-review').reviewRenderer({production,documentScanner:options.documentScanner});
  const reviewAction = fn => wrap(async (req,res,next) => {
    try { return await fn(req,res,next); }
    catch (error) {
      if (error.expose && [400,409,503].includes(error.status) && req.accepts(['html','json']) !== 'json') {
        return renderReview(req,res,{status:error.status,error:error.message,values:{
          notes:scalar(req.body.notes).slice(0,2000),reviewed:req.body.reviewed==='yes',
          authorizationReviewed:req.body.authorizationReviewed==='yes',locationReviewed:req.body.locationReviewed==='yes',
        }});
      }
      throw error;
    }
  });
  require('./lib/config').validateEnvironment();
  app.get('/health/live',(req,res)=>res.json({status:'ok'}));
  app.get(['/health','/health/ready'],async(req,res)=>{res.set('Cache-Control','no-store');try{res.json(await require('./lib/health').readiness());}catch{res.status(503).json({status:'unavailable'});}});
  // Error pages must also render when body parsing or session loading fails.
  Object.assign(app.locals, {
    user: null,
    csrf: "",
    q: {},
    amenities,
    sharing,
    localities,
    title: "PG Dekho",
    coverPhoto,
    submissionIssues,
    favoriteIds: new Set(),
    directoryFavoriteIds: new Set(),
    compareIds: new Set(),
    authorizationTypes,
    market,
    hasLive: publication.live,
    photoTypes: require("./lib/photos").photoTypes,
    listingState: (status) =>
      ({
        draft: "Draft — not sent to admin",
        submitted: "Pending admin approval",
        approved: "Approved — awaiting publication",
        published: "Approved — visible to students",
        rejected: "Rejected — changes needed",
        corrections: "Corrections requested",
      })[status] || "Draft — not sent to admin",
  });
  app.locals.publicationState=l=>l.publicHidden?'Unpublished — not public':l.listingStatus==='published'&&!publication.live(l)?'Review required — not public':app.locals.listingState(l.listingStatus||'draft');
  if (
    production &&
    (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
  )
    throw problem(400,
      "Production requires a SESSION_SECRET of at least 32 characters.",
    );
  app.disable("x-powered-by");
  if (production) app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "blob:", ...photoOrigins],
          frameSrc: ["'none'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: production ? [] : null,
        },
      },
      strictTransportSecurity: production ? undefined : false,
    }),
  );
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  app.set("query parser", "simple");
  app.use(express.static(path.join(__dirname, "public")));
  require('./routes/security').registerEmailWebhook(app);
  app.use(express.urlencoded({ extended: false, limit: "48kb" }));
  const sessionOptions = {
    secret:
      process.env.SESSION_SECRET || crypto.randomBytes(48).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: production,
      maxAge: 86400000,
    },
    name: "nestly.sid",
  };
  if (!options.memorySession)
    sessionOptions.store =
      options.sessionStore ||
      MongoStore.create({
        mongoUrl:
          options.mongoUrl ||
          process.env.MONGO_URL ||
          "mongodb://127.0.0.1:27017/nestly",
        mongoOptions: { maxPoolSize: 10 },
      });
  app.locals.sessionStore=sessionOptions.store;
  app.use(session(sessionOptions));
  app.use(
    wrap(async (req, res, next) => {
      // HTML includes session-specific CSRF fields even for anonymous comparison controls.
      res.set('Cache-Control','private, no-store');
      req.user = req.session.userId
        ? await User.findById(req.session.userId).select(
            "name email role favorites directoryFavorites suspended suspensionReason sessionVersion emailVerifiedAt mfa.enabled",
          )
        : null;
      if (req.user || req.session.pendingMfaUserId || /^\/(login|signup|account|owner|admin|inquiries|favorites|compare|reports|reset-password|forgot-password|mfa)/.test(req.path)) res.set('Cache-Control','private, no-store');
      if (req.user?.suspended) {
        req.session.userId = null;
        req.user = null;
        return res.status(403).render("error", {
          message:
            "This account is suspended. Contact the platform administrator.",
        });
      }
      if(req.user && (req.user.sessionVersion||0)!==(req.session.sessionVersion||0)){req.session.userId=null;req.user=null;}
      res.locals.favoriteIds = new Set((req.user?.favorites || []).map(String));
      res.locals.directoryFavoriteIds = new Set((req.user?.directoryFavorites || []).map(String));
      res.locals.compareIds = new Set(
        (req.session.comparison || []).map(String),
      );
      if (!req.session.csrf)
        req.session.csrf = crypto.randomBytes(32).toString("hex");
      res.locals.user = req.user;
      res.locals.csrf = req.session.csrf;
      res.locals.amenities = amenities;
      res.locals.sharing = sharing;
      res.locals.q = req.query;
      res.locals.money = (v) =>
        v == null
          ? "Contact for rent details"
          : "₹" + Number(v).toLocaleString("en-IN");
      res.locals.date = (v) =>
        v ? new Date(v).toLocaleDateString("en-IN") : "Not confirmed";
      res.locals.title = "PG Dekho";
      if (
        !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        req.get("x-csrf-token") !== req.session.csrf &&
        req.body?._csrf !== req.session.csrf
      )
        return res.status(403).render("error", {
          message: "Your form expired. Reload the page and try again.",
        });
      next();
    }),
  );
  const auth = (req, res, next) => {
    if (req.user) return next();
    if (req.path.startsWith("/owner") || req.path === "/listings/new")
      req.session.returnTo = "/owner/new";
    res.redirect("/login");
  };
  const role = roles => (req,res,next)=>{
    if(!req.user||!roles.includes(req.user.role))return res.status(403).render('error',{message:roles.length===1&&roles[0]==='admin'?'Only an administrator can review PG submissions. Sign in with your administrator account.':roles.includes('owner')&&req.user?.role==='user'?'This account is registered as a Student / seeker. Sign in with the PG owner account that saved your property to manage or submit it.':'You do not have permission to access this page.'});
    if(production && req.user.role==='admin' && (!req.user.emailVerifiedAt||!req.user.mfa?.enabled||!req.session.mfaVerified))return res.redirect('/account/security');
    if(production && req.user.role==='owner' && !req.user.emailVerifiedAt)return res.redirect('/account/security');
    next();
  };
  require('./routes/security').registerSecurity({app,auth,wrap,emailTransport:options.emailTransport});
  require('./routes/directory').registerDirectory({app,auth,role,wrap});
  app.param("id", (req, res, next, id) =>
    mongoose.isValidObjectId(id)
      ? next()
      : res.status(404).render("error", { message: "Page not found." }),
  );
  const owned = async (req) => {
    const l = await Listing.findById(req.params.id);
    if (!l) {
      const e = Error("Property not found.");
      e.status = 404;
      throw e;
    }
    if (String(l.ownerId) !== String(req.user._id)) {
      const e = Error("This property belongs to another owner.");
      e.status = 403;
      throw e;
    }
    return l;
  };
  const authLimit=limiter('authentication',{account:30,ip:120,windowMs:900000,override:options.actionLimit,key:req=>typeof req.body.email==='string'?req.body.email.trim().toLowerCase():null});
  const inquiryLimit=limiter('inquiries',{account:20,ip:1200,override:options.actionLimit});
  const reportLimit=limiter('reports',{account:10,ip:600,override:options.actionLimit});
  const contactLimit=limiter('contact',{account:120,ip:2400,override:options.actionLimit});
  const uploadLimit=limiter('uploads',{account:30,ip:600,override:options.actionLimit});
  app.get(
    "/",
    wrap(async (req, res) =>
      res.render("home", {
        listings: (
          await publication.findPublic(
            { listingStatus: "published" },
            { createdAt: -1, _id: -1 },
            1,
            6,
          )
        ).listings,
      }),
    ),
  );
  app.get(
    "/listings",
    wrap(async (req, res) => {
      const { query, page, sort } = filters(req.query);
      const { listings, total } = await publication.findPublic(
        query,
        sort,
        page,
      );
      const url = new URLSearchParams();
      for (const [key, value] of Object.entries(req.query)) {
        if (key === "page") continue;
        for (const v of Array.isArray(value) ? value : [value])
          if (typeof v === "string") url.append(key, v);
      }
      res.render("listings/index", {
        listings,
        directoryResults: !req.query.area || req.query.area === 'Rajanukunte' ? await directory.search(req.query.category, 1, 4) : null,
        total,
        page,
        pages: Math.ceil(total / 12),
        base: "/listings?" + url.toString(),
      });
    }),
  );
  function accountPage(signup) {
    return (req, res) => {
      if (["/owner", "/owner/new"].includes(req.query.next))
        req.session.returnTo = req.query.next;
      res.render("auth", { signup });
    };
  }
  app.get("/signup", accountPage(true));
  app.get("/login", accountPage(false));
  app.get("/list-property", (req, res) => {
    if (["owner", "admin"].includes(req.user?.role))
      return res.redirect("/owner/new");
    res.render("owner-start");
  });
  // An existing student account can never grant itself owner access.
  app.post("/owner/start", auth, (req, res) =>
    res.status(403).render("error", {
      message:
        "Student accounts cannot become owners here. Register a separate PG owner account to list a property.",
    }),
  );
  app.get(
    "/account",
    auth,
    wrap(async (req, res) =>
      res.render("account", {
        hasListings: await Listing.exists({ ownerId: req.user._id }),
      }),
    ),
  );
  app.post(
    "/account/student",
    auth,
    role(["owner"]),
    wrap(async (req, res) => {
      if (await Listing.exists({ ownerId: req.user._id }))
        return res.status(409).render("error", {
          message:
            "This owner account manages PG listings and cannot be changed to a student account.",
        });
      if (req.body.confirm !== "student")
        return res.status(400).render("error", {
          message: "Confirm that you want to use a student account.",
        });
      await User.updateOne(
        { _id: req.user._id, role: "owner" },
        { $set: { role: "user" } },
      );
      await audit(req,'account.student','User',req.user._id);
      res.redirect("/account?changed=1");
    }),
  );
  app.post(
    "/signup",
    authLimit,
    wrap(async (req, res) => {
      const name = scalar(req.body.name),
        email = scalar(req.body.email).toLowerCase(),
        password = typeof req.body.password==='string'?req.body.password:'';
      if (
        !name ||
        name.length > 80 ||
        !/^\S+@\S+\.\S+$/.test(email) ||
        email.length > 254 ||
        password.length < 12 ||
        !password.trim() ||
        Buffer.byteLength(password, "utf8") > 72
      )
        throw problem(400,
          "Enter your name, valid email, and a password of at least 12 characters and no more than 72 UTF-8 bytes.",
        );
      const user = await User.create({
        name,
        email,
        passwordHash: await bcrypt.hash(password, 12),
        role: req.body.role === "owner" ? "owner" : "user",
      });
      const returnTo = req.session.returnTo;
      await new Promise((resolve, reject) =>
        req.session.regenerate((e) => (e ? reject(e) : resolve())),
      );
      req.session.userId = user._id.toString();
      res.redirect(user.role === "owner" ? returnTo || "/owner/new" : "/");
    }),
  );
  app.post(
    "/login",
    authLimit,
    wrap(async (req, res) => {
      const user = await User.findOne({
        email: scalar(req.body.email).toLowerCase(),
      });
      const password = typeof req.body.password==='string'?req.body.password:'';
      if (
        password.length > 128 ||
        !user ||
        !user.passwordHash ||
        !(await bcrypt.compare(password, user.passwordHash))
      )
        throw problem(400,"Email or password is incorrect.");
      if(user.suspended)throw problem(403,'This account is suspended.');
      const returnTo = req.session.returnTo;
      await new Promise((resolve, reject) =>
        req.session.regenerate((e) => (e ? reject(e) : resolve())),
      );
      if(user.mfa?.enabled){req.session.pendingMfaUserId=String(user._id);req.session.pendingMfaExpiresAt=Date.now()+300000;return res.redirect('/mfa');}
      req.session.userId = user._id.toString();
      req.session.sessionVersion=user.sessionVersion||0;
      res.redirect(
        user.role === "admin"
          ? "/admin"
          : returnTo && user.role === "owner"
            ? returnTo
            : user.role === "owner"
              ? "/owner"
              : "/",
      );
    }),
  );
  app.post("/logout", auth, (req, res, next) =>
    req.session.destroy((e) =>
      e ? next(e) : res.clearCookie("nestly.sid").redirect("/"),
    ),
  );
  app.get("/listings/new", auth, role(["owner", "admin"]), (req, res) =>
    res.redirect("/owner/new"),
  );
  app.get(
    "/owner",
    auth,
    role(["owner", "admin"]),
    wrap(async (req, res) => {
      const page = market.page(req.query.page),
        inboxPage = market.page(req.query.inboxPage);
      const inboxQuery = { ownerId: req.user._id };
      if (
        ["new", "contacted", "visit_scheduled", "closed"].includes(
          req.query.inquiryStatus,
        )
      )
        inboxQuery.status = req.query.inquiryStatus;
      const [listings, total, inquiries, inquiryTotal, counts] =
        await Promise.all([
          Listing.find({ ownerId: req.user._id })
            .select(
              "-authorizationDocuments -approvedAuthorizationDocuments -publicSnapshot -houseRules -reports",
            )
            .sort({ updatedAt: -1 })
            .skip((page - 1) * 12)
            .limit(12)
            .lean(),
          Listing.countDocuments({ ownerId: req.user._id }),
          Inquiry.find(inboxQuery)
            .populate("propertyId", "name")
            .populate("userId", "name email")
            .sort({ createdAt: -1 })
            .skip((inboxPage - 1) * 20)
            .limit(20)
            .lean(),
          Inquiry.countDocuments(inboxQuery),
          Inquiry.aggregate([
            { $match: { ownerId: req.user._id } },
            { $group: { _id: "$propertyId", count: { $sum: 1 } } },
          ]),
        ]);
      // Document existence is enough for checklist; private bytes/metadata do not belong in dashboard responses.
      const summaries = await Listing.find({
        _id: { $in: listings.map((l) => l._id) },
      })
        .select(
          "authorizationDocuments.declaration publicSnapshot.listingStatus publicSnapshot.locality publicSnapshot.publicationPolicyVersion publicHidden ownerSuspended",
        )
        .lean();
      const byId = new Map(summaries.map((l) => [String(l._id), l]));
      for (const l of listings) {
        const detail = byId.get(String(l._id));
        l.authorizationDocuments = detail?.authorizationDocuments || [];
        l.publicSnapshot = detail?.publicSnapshot;
        l.publicHidden = detail?.publicHidden;
        l.ownerSuspended = detail?.ownerSuspended;
        l.inquiryCount =
          counts.find((c) => String(c._id) === String(l._id))?.count || 0;
      }
      res.render("dashboard", {
        listings,
        inquiries,
        total,
        page,
        pages: Math.ceil(total / 12),
        inboxPage,
        inboxPages: Math.ceil(inquiryTotal / 20),
      });
    }),
  );
  app.get("/owner/new", auth, role(["owner", "admin"]), (req, res) =>
    res.render("listings/form", {
      listing: { sharingOptions: [], amenities: [], foodOptions: [] },
    }),
  );
  const uploadDir = path.resolve(
    process.env.UPLOAD_DIR || path.join(__dirname, "uploads"),
  );
  const authorizationDir = path.resolve(
    process.env.AUTHORIZATION_DIR ||
      path.join(uploadDir, "private-authorization"),
  );
  const saveProperty = wrap(async (req, res) => {
    const existing = req.params.id ? await owned(req) : null;
    if(!existing && await Listing.countDocuments({ownerId:req.user._id})>=20)throw problem(400,'You can manage up to 20 properties. Contact the administrator for more.');
    const input = parse(req.body);
    if (existing) publication.preservePublished(existing);
    const listing =
      existing ||
      new Listing({ ownerId: req.user._id, listingStatus: "draft" });
    const oldCoordinates = listing.coordinates?.toObject
      ? listing.coordinates.toObject()
      : listing.coordinates;
    if (
      oldCoordinates &&
      input.coordinates &&
      oldCoordinates.latitude === input.coordinates.latitude &&
      oldCoordinates.longitude === input.coordinates.longitude &&
      oldCoordinates.mapUrl === input.coordinates.mapUrl &&
      listing.address === input.address &&
      listing.locality === input.locality
    )
      input.coordinates.verified = oldCoordinates.verified;
    Object.assign(listing, input);
    publication.restrictSnapshot(listing);
    // A check of the previously approved version must not certify new owner edits.
    listing.verification = { method: "unverified" };
    listing.propertyVerificationStatus = "unverified";
    const files = [
      ...(req.files?.buildingPhoto || []).map((file) => ({
        file,
        type: "Exterior",
      })),
      ...(req.files?.galleryPhotos || []).map((file) => ({
        file,
        type: "Interior",
      })),
    ];
    let prepared = [];
    let preparedDocuments = [];
    let persisted = false;
    try {
      if (files.length && req.body.photoRights !== "yes")
        throw problem(400,
          "Confirm permission to publish every selected property photograph.",
        );
      if (listing.images.length + files.length > 12)
        throw problem(400,
          "Maximum 12 photographs per property. Remove an existing photo first.",
        );
      if (
        (listing.authorizationDocuments || []).length +
          (req.files?.authorizationFiles || []).length >
        3
      )
        throw problem(400,
          "Maximum 3 authorization documents per PG. Remove an old document before replacing it.",
        );
      preparedDocuments = await prepareAuthorization(
        req.files?.authorizationFiles || [],
        req.body,
        req.user._id,
        authorizationDir,
        options.documentScanner,
      );
      listing.authorizationDocuments.push(...preparedDocuments);
      resetAuthorization(listing);
      prepared = await preparePhotos(files, req.user._id, uploadDir);
      listing.images.push(...prepared);
      if (req.files?.buildingPhoto?.length)
        listing.coverImageId =
          listing.images[listing.images.length - prepared.length]._id;
      listing.listingStatus = "draft";
      listing.photoReviewStatus = "pending";
      for (const image of listing.images) image.status = "pending";
      const wantsSubmit = req.body.intent !== "draft";
      const issues = wantsSubmit ? submissionIssues(listing) : [];
      if (wantsSubmit && !issues.length) {
        listing.listingStatus = "submitted";
        listing.submittedAt = new Date();
      }
      await listing.save();
      persisted = true;
      await audit(req,existing?'property.edit':'property.create','Listing',listing._id,{state:listing.listingStatus});
      const redirectTo =
        listing.listingStatus === "submitted"
          ? "/owner?submitted=1"
          : "/owner/" +
            listing._id +
            "/edit?" +
            (issues.length ? "incomplete=1" : "saved=1");
      if (req.accepts(["html", "json"]) === "json")
        return res.status(issues.length ? 422 : 200).json({
          redirectTo,
          status: listing.listingStatus,
          id: String(listing._id),
          issues,
          message: issues.length
            ? "Your PG is saved as a draft, but has not been sent to admin. Complete: " +
              issues.join(", ")
            : "Your PG was saved.",
        });
      res.redirect(redirectTo);
    } catch (error) {
      if(persisted)throw error;
      await discardPhotos(prepared, uploadDir);
      await discardAuthorization(preparedDocuments, authorizationDir);
      if (error.name === "VersionError")
        throw problem(400,
          "This property changed in another window. Reload it before saving.",
        );
      const values = listing.toObject();
      values.images = values.images.filter(
        (image) => !prepared.some((p) => p.filename === image.filename),
      );
      values.authorizationDocuments = (
        values.authorizationDocuments || []
      ).filter(
        (document) =>
          !preparedDocuments.some((d) => d.filename === document.filename),
      );
      if (!existing) delete values._id;
      if(!error.status && error.name!=="ValidationError")throw error;
      res.status(error.status||400).render("listings/form", {
        listing: values,
        errorMessage: error.message,
      });
    }
  });
  const uploadGate=uploadGuard({globalLimit:options.uploadLimit||2});
  app.post(
    "/owner",
    auth,
    role(["owner", "admin"]),
    uploadLimit,
    uploadGate,
    propertyUpload,
    saveProperty,
  );
  app.get(
    "/owner/:id/edit",
    auth,
    role(["owner", "admin"]),
    wrap(async (req, res) =>
      res.render("listings/form", { listing: await owned(req) }),
    ),
  );
  app.post(
    "/owner/:id",
    auth,
    role(["owner", "admin"]),
    uploadLimit,
    wrap(async (req, res, next) => {
      await owned(req);
      next();
    }),
    uploadGate,
    propertyUpload,
    saveProperty,
  );
  app.post(
    "/owner/:id/photos",
    auth,
    role(["owner", "admin"]),
    uploadLimit,
    wrap(async (req, res, next) => {
      req.listing = await owned(req);
      next();
    }),
    uploadGate,
    singleUpload,
    wrap(async (req, res) => {
      const listing = req.listing;
      publication.preservePublished(listing);
      if (!req.file)
        throw problem(400,"Select a JPEG, PNG or WebP photo up to 4 MB.");
      if (req.body.rights !== "yes")
        throw problem(400,
          "Confirm you have permission to publish this property photograph.",
        );
      if (listing.images.length >= 12)
        throw problem(400,"Maximum 12 photographs per property.");
      const prepared = await preparePhotos(
        [{ file: req.file, type: req.body.type }],
        req.user._id,
        uploadDir,
      );
      try {
        listing.images.push(...prepared);
        listing.listingStatus = "draft";
        listing.photoReviewStatus = "pending";
        await listing.save();
      } catch (error) {
        await discardPhotos(prepared, uploadDir);
        throw error;
      }
      await audit(req,'property.photo.add','Listing',listing._id,{count:prepared.length});
      res.redirect("/owner/" + listing._id + "/edit?saved=1");
    }),
  );
  app.get(
    "/listings/:id/authorization/:documentId",
    auth,
    wrap(async (req, res) => {
      const listing = await Listing.findById(req.params.id);
      if (!listing) return res.sendStatus(404);
      if(production && req.user.role==='admin' && (!req.user.emailVerifiedAt||!req.user.mfa?.enabled||!req.session.mfaVerified))return res.redirect('/account/security');
      if (
        req.user.role !== "admin" &&
        String(listing.ownerId) !== String(req.user._id)
      )
        return res.sendStatus(403);
      if (!mongoose.isValidObjectId(req.params.documentId))
        return res.sendStatus(404);
      const document =
        listing.authorizationDocuments.id(req.params.documentId) ||
        listing.approvedAuthorizationDocuments?.id(req.params.documentId);
      if (!document || !/^([a-f0-9]{48})\.(pdf|webp)$/.test(document.filename))
        return res.sendStatus(404);
      if(document.scanStatus!=='clean')throw problem(423,'This document is quarantined pending a successful security scan. It has not been authenticated.');
      await audit(req,'document.access','Listing',listing._id,{documentId:String(document._id),reviewState:document.status});
      res.set({
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "X-Content-Type-Options": "nosniff",
      });
      res.type(document.mimeType);
      if (document.mimeType === "application/pdf")
        res.attachment("PG-authorization-document.pdf");
      res.sendFile(createStorage({privateRoot:authorizationDir}).path('document',document.filename));
    }),
  );
  app.post(
    "/owner/:id/authorization/:documentId/delete",
    auth,
    role(["owner", "admin"]),
    wrap(async (req, res) => {
      const listing = await owned(req);
      if (!mongoose.isValidObjectId(req.params.documentId))
        return res.sendStatus(404);
      const document = listing.authorizationDocuments.id(req.params.documentId);
      if (!document) return res.sendStatus(404);
      publication.preservePublished(listing);
      const filename = document.filename;
      document.deleteOne();
      listing.listingStatus = "draft";
      resetAuthorization(listing);
      await listing.save();
      await audit(req,'property.document.remove','Listing',listing._id,{documentId:req.params.documentId});
      if (
        !listing.approvedAuthorizationDocuments?.some(
          (document) => document.filename === filename,
        )
      )
        await discardAuthorization([{ filename }], authorizationDir);
      res.redirect("/owner/" + listing._id + "/edit?saved=1");
    }),
  );
  app.get(
    "/media/:filename",
    wrap(async (req, res) => {
      if (!/^[a-f0-9]{48}(\.thumb)?\.webp$/.test(req.params.filename))
        return res.sendStatus(404);
      const l = await Listing.findOne({
        $or: [
          { "images.filename": req.params.filename },
          { "images.thumbnail": req.params.filename },
          { "publicSnapshot.images.thumbnail": req.params.filename },
          { "publicSnapshot.images.filename": req.params.filename },
        ],
      }).select(
        "locality ownerId images publicSnapshot.images publicSnapshot.listingStatus publicSnapshot.locality publicSnapshot.publicationPolicyVersion publicationPolicyVersion listingStatus publicHidden ownerSuspended",
      );
      if (!l) return res.sendStatus(404);
      const img = l.images.find((i) => (i.filename === req.params.filename || i.thumbnail === req.params.filename));
      const liveImage = (l.publicSnapshot?.images || []).find(
        (i) => (i.filename === req.params.filename || i.thumbnail === req.params.filename),
      );
      const privileged =
        req.user &&
        (req.user.role!=='admin'||!production||(req.user.emailVerifiedAt&&req.user.mfa?.enabled&&req.session.mfaVerified)) &&
        (req.user.role === "admin" ||
          String(req.user._id) === String(l.ownerId));
      if (
        !privileged &&
        (!publication.live(l) ||
          !(await User.exists({ _id: l.ownerId, role:{$in:['owner','admin']}, suspended:{$ne:true}, ...(production?{emailVerifiedAt:{$exists:true,$ne:null}}:{}) })) ||
          (!liveImage &&
            (l.listingStatus !== "published" || img?.status !== "approved")))
      )
        return res.sendStatus(404);
      res.set(
        "Cache-Control",
        privileged
          ? "private, no-store"
          : "private, max-age=60, must-revalidate",
      );
      res.sendFile(createStorage({publicRoot:uploadDir}).path('photo',req.params.filename));
    }),
  );
  app.post(
    "/owner/:id/photos/:photoId/delete",
    auth,
    role(["owner", "admin"]),
    wrap(async (req, res) => {
      const l = await owned(req);
      const img = l.images.id(req.params.photoId);
      if (!img) return res.sendStatus(404);
      publication.preservePublished(l);
      const filename = img.filename;
      img.deleteOne();
      l.listingStatus = "draft";
      l.photoReviewStatus = "pending";
      await l.save();
      await audit(req,'property.photo.remove','Listing',l._id,{photoId:req.params.photoId});
      if (
        !(l.publicSnapshot?.images || []).some(
          (image) => image.filename === filename,
        )
      )
        await discardPhotos([{filename,thumbnail:img.thumbnail}],uploadDir);
      res.redirect("/owner/" + l._id + "/edit");
    }),
  );
  app.post(
    "/owner/:id/submit",
    auth,
    role(["owner", "admin"]),
    wrap(async (req, res) => {
      const l = await owned(req);
      const issues = submissionIssues(l);
      if (issues.length)
        throw problem(400,"Complete before submission: " + issues.join(", "));
      if (!publishable(l))
        throw problem(400,
          "Complete the name, description, address, locality, category, sharing, contact details and owner authorization before submitting.",
        );
      const issue = submissionError(l);
      if (issue) throw problem(400,issue);
      publication.preservePublished(l);
      l.listingStatus = "submitted";
      l.submittedAt = new Date();
      await l.save();
      await audit(req,'property.submit','Listing',l._id);
      res.redirect("/owner?submitted=1");
    }),
  );
  registerPortalRoutes({ app, auth, role, wrap, actionLimit:contactLimit, owned });
  require("./routes/operations").registerOperations({app,auth,role,wrap,reviewAction,owned,authorizationDir,documentScanner:options.documentScanner});
  app.get(
    "/admin",
    auth,
    role(["admin"]),
    wrap(async (req, res) => {
      const history = req.query.view === "all";
      const drafts = req.query.view === "drafts";
      const query = history
        ? {}
        : drafts ? {listingStatus:"draft"}
        : {$or:[{listingStatus:"submitted"},{"withdrawalRequest.requestedAt":{$exists:true},"withdrawalRequest.reviewedAt":null}]};
      const page = market.page(req.query.page);
      const [listings, pendingCount, draftCount, total, summary] = await Promise.all([
        Listing.find(query)
          .populate("ownerId", "name email")
          .select(
            "name locality listingStatus submittedAt updatedAt images._id authorizationDocuments._id reports.status publicSnapshot.listingStatus publicSnapshot.locality publicSnapshot.publicationPolicyVersion publicationPolicyVersion publicHidden ownerSuspended",
          )
          .sort({ submittedAt: -1, updatedAt: -1 })
          .skip((page - 1) * 12)
          .limit(12)
          .lean(),
        Listing.countDocuments({$or:[{listingStatus:"submitted"},{"withdrawalRequest.requestedAt":{$exists:true},"withdrawalRequest.reviewedAt":null}]}),
        Listing.countDocuments({listingStatus:"draft"}),
        Listing.countDocuments(query),
        Promise.all([
          publication.findPublic(
            { listingStatus: "published" },
            { createdAt: -1 },
            1,
            1,
          ),
          User.countDocuments({ role: "owner" }),
          Inquiry.countDocuments({}),
          Listing.countDocuments({ "reports.status": "open" }),
        ]),
      ]);
      res.render("admin", {
        listings,
        pendingCount,
        draftCount,
        history,
        drafts,
        page,
        pages: Math.ceil(total / 12),
        summary: {
          published: summary[0].total,
          owners: summary[1],
          inquiries: summary[2],
          reported: summary[3],
        },
      });
    }),
  );
  app.get(
    "/admin/:id",
    auth,
    role(["admin"]),
    wrap((req, res) => renderReview(req, res)),
  );
  app.post(
    "/admin/:id",
    auth,
    role(["admin"]),
    reviewAction(async (req, res) => {
      const l = await Listing.findById(req.params.id);
      if (!l) return res.sendStatus(404);
      const action = scalar(req.body.action);
      const notes = scalar(req.body.notes);
      if(['approve','publish'].includes(action)){
        const owner=await User.findById(l.ownerId).select('role suspended emailVerifiedAt');
        if(!owner||owner.suspended||!['owner','admin'].includes(owner.role))throw problem(400,'A current, active owner account is required before publication.');
        if(production&&!owner.emailVerifiedAt)throw problem(400,'The owner must verify the account email before publication.');
      }
      if (notes.length > 2000) throw problem(400,"Notes too long.");
      if (
        !["approve", "reject", "corrections", "unpublish", "publish"].includes(
          action,
        )
      )
        throw problem(400,"Unknown action.");
      if (
        ["reject", "corrections", "unpublish"].includes(action) &&
        notes.trim().length < 10
      )
        throw problem(400,"Provide a clear reason of at least 10 characters.");
      if (action === "approve") {
        if (
          l.ownerSuspended ||
          (await User.exists({ _id: l.ownerId, suspended: true }))
        )
          throw problem(400,"Restore the suspended owner before approving this PG.");
        const issues = submissionIssues(l);
        if (issues.length) throw problem(400,"Cannot approve: " + issues.join(", "));
        l.coordinates.verified = Boolean(
          req.body.locationReviewed === "yes" &&
          l.coordinates.publicationAuthorized &&
          exactLocationUrl(l.coordinates),
        );
        if (l.listingStatus !== "submitted" || !publishable(l))
          throw problem(400,"Only complete submitted listings may be approved.");
        if (req.body.reviewed !== "yes")
          throw problem(400,
            "Confirm property data, authorization and all photo rights have been reviewed.",
          );
        if (req.body.authorizationReviewed !== "yes")
          throw problem(400,
            "Review the PG operation authorization documents and confirm the document review before approving.",
          );
        const issue = submissionError(l);
        if (issue) throw problem(400,issue);
        for (const img of l.images) {
          if (!img.rightsDeclared) throw problem(400,"Missing image rights.");
          img.status = "approved";
        }
        if(l.authorizationDocuments.some(d=>d.scanStatus!=='clean'))throw problem(400,'Every authorization document must pass security scanning before approval. Parsing does not establish authenticity.');
        for (const document of l.authorizationDocuments) {
          document.status = "accepted";
          document.reviewedBy = req.user._id;
          document.reviewedAt = new Date();
          document.reviewNotes = notes;
        }
        l.approvedAt = new Date();
        l.photoReviewStatus = "reviewed";
        publication.publish(l);
      }
      if (action === "publish") {
        if (
          l.ownerSuspended ||
          (await User.exists({ _id: l.ownerId, suspended: true }))
        )
          throw problem(400,"Restore the suspended owner before publishing this PG.");
        const issues = submissionIssues(l);
        if (issues.length) throw problem(400,"Cannot publish: " + issues.join(", "));
        if (
          !l.authorizationDocuments.some(
            (d) => d.scanStatus === "clean" && d.status === "accepted" && d.reviewedBy && d.reviewedAt,
          )
        )
          throw problem(400,
            "Authorization documents must be reviewed before publication. Resubmit the PG for review.",
          );
        if (l.listingStatus !== "approved" || !publishable(l))
          throw problem(400,"Approve the current listing before publishing.");
        publication.publish(l);
      }
      if (action === "reject") {
        publication.preservePublished(l);
        l.listingStatus = "rejected";
      }
      if (action === "corrections") {
        publication.preservePublished(l);
        l.listingStatus = "corrections";
      }
      if (action === "unpublish") {
        publication.preservePublished(l);
        l.publicHidden = true;
        l.listingStatus = "draft";
      }
      if(['approve','unpublish'].includes(action)&&l.withdrawalRequest?.requestedAt){l.withdrawalRequest.reviewedAt=new Date();l.withdrawalRequest.reviewedBy=req.user._id;}
      l.moderationNotes = notes;
      l.moderationHistory.push({
        action,
        notes,
        actorId: req.user._id,
        at: new Date(),
      });
      await l.save();
      await audit(req,'listing.'+action,'Listing',l._id,{state:l.listingStatus,reason:notes});
      res.redirect("/admin/" + l._id);
    }),
  );
  app.get(
    "/inquiries",
    auth,
    wrap(async (req, res) => {
      const page = market.page(req.query.page);
      const query = { userId: req.user._id };
      const [inquiries, total] = await Promise.all([
        Inquiry.find(query)
          .populate("propertyId", "publicSnapshot.name")
          .sort({ createdAt: -1 })
          .skip((page - 1) * 20)
          .limit(20)
          .lean(),
        Inquiry.countDocuments(query),
      ]);
      res.render("inquiries", {
        inquiries,
        page,
        pages: Math.ceil(total / 20),
      });
    }),
  );
  app.post(
    "/listings/:id/inquiries",
    auth,
    inquiryLimit,
    wrap(async (req, res) => {
      if(production && !req.user.emailVerifiedAt)throw problem(403,'Verify your account email before sending an inquiry.');
      const l = await publication.getPublic(req.params.id);
      if (!l) return res.sendStatus(404);
      const message = scalar(req.body.message),
        v = scalar(req.body.preferredVisitDate);
      if (message.length < 10 || message.length > 2000)
        throw problem(400,"Write a message between 10 and 2000 characters.");
      const visit=market.dateInput(v,'Preferred visit date',{future:true});
      const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
      if(v && (v<today || visit>Date.now()+90*86400000))throw problem(400,'Choose a visit date within the next 90 days.');
      await Inquiry.create({
        propertyId: l._id,
        propertyName: l.name,
        userId: req.user._id,
        ownerId: l.ownerId,
        message,
        preferredVisitDate: v || null,
        contactMethod: "email",
      });
      res.redirect("/inquiries?sent=1");
    }),
  );
  app.post(
    "/inquiries/:id/status",
    auth,
    role(["owner", "admin"]),
    wrap(async (req, res) => {
      if (
        !["new", "contacted", "visit_scheduled", "closed"].includes(
          req.body.status,
        )
      )
        throw problem(400,"Invalid inquiry status.");
      const reply = scalar(req.body.reply);
      if (reply.length > 2000)
        throw problem(400,"Reply must be at most 2000 characters.");
      const inquiry = await Inquiry.findOne({_id:req.params.id,ownerId:req.user._id});
      if(!inquiry)return res.sendStatus(404);
      let scheduled=null;
      if(req.body.status==='visit_scheduled'){
        const raw=scalar(req.body.scheduledVisitAt);
        scheduled=raw && raw!==market.localVisit(inquiry.scheduledVisitAt) ? market.scheduledVisit(raw) : inquiry.scheduledVisitAt;
        if(!scheduled)throw problem(400,'Enter the scheduled visit date and time in IST.');
      }
      inquiry.status = req.body.status;
      inquiry.statusUpdatedAt = new Date();
      inquiry.scheduledVisitAt = scheduled;
      if (reply) inquiry.reply = reply;
      inquiry.history.push({
        status: inquiry.status,
        reply,
        at: new Date(),
        actorId: req.user._id,
      });
      if (inquiry.history.length > 30)
        inquiry.history = inquiry.history.slice(-30);
      await inquiry.save();
      res.redirect("/owner?tab=inquiries");
    }),
  );
  app.post(
    "/listings/:id/report",
    auth,
    reportLimit,
    wrap(async (req, res) => {
      const message = scalar(req.body.message);
      if (message.length < 10 || message.length > 1000)
        throw problem(400,"Provide a report of 10–1000 characters.");
      const visible = await publication.getPublic(req.params.id);
      if (!visible) return res.sendStatus(404);
      const result = await Listing.updateOne(
        { _id: req.params.id, reports:{$not:{$elemMatch:{userId:req.user._id,status:'open'}}}, $expr:{$lt:[{$size:{$ifNull:['$reports',[]]}},2000]} },
        {
          $push: {
            reports: {
              $each: [
                {
                  userId: req.user._id,
                  propertyName: visible.name,
                  message,
                  createdAt: new Date(),
                  status: "open",
                },
              ],
            },
          },
        },
      );
      if (!result.matchedCount) throw problem(409,'You may already have an open report for this property, or its report queue needs administrator attention. Existing reports are retained.');
      res.render("message", {
        heading: "Report received",
        message: "An administrator can now review your report.",
      });
    }),
  );
  app.get(
    "/listings/:id",
    wrap(async (req, res) => {
      const listing = await publication.getPublic(req.params.id);
      if (!listing)
        return res.status(404).render("error", {
          message: "This property is not currently published.",
        });
      const today = new Date().toISOString().slice(0, 10);
      const seen = req.session.viewedListings || {};
      if (
        seen[req.params.id] !== today &&
        (!req.user ||
          (req.user.role !== "admin" &&
            String(req.user._id) !== String(listing.ownerId)))
      ) {
        await Listing.updateOne(
          { _id: listing._id },
          { $inc: { "statistics.views": 1 } },
        );
        seen[req.params.id] = today;
        req.session.viewedListings = Object.fromEntries(
          Object.entries(seen).slice(-100),
        );
      }
      const selected = sharing.includes(scalar(req.query.sharing))
        ? req.query.sharing
        : (listing.roomOptions || [])[0]?.sharing ||
          listing.sharingOptions?.[0];
      res.render("listings/show", {
        listing,
        selected,
        cost: market.moveIn(listing, selected),
        map: market.maps(listing),
      });
    }),
  );
  for (const page of ["about", "contact", "privacy", "terms"])
    app.get("/" + page, (req, res) => res.render("info", { page }));
  app.use((req, res) =>
    res
      .status(404)
      .render("error", { message: "We could not find that page." }),
  );
  app.use((err, req, res, next) => {
    if(options.onError)options.onError(err);
    if (res.headersSent) return next(err);
    const expected =
      err.name === "ValidationError" ||
      err.name === "CastError" ||
      err.code === 11000 ||
      err instanceof multer.MulterError;
    const status =
      err.status ||
      (err.name==='VersionError'?409:expected
        ? 400
        : err.name === "MongooseServerSelectionError"
          ? 503
          : 500);
    res.set('Cache-Control','private, no-store');
    if(status>=500)log('error','request.failed',{requestId:crypto.randomUUID(),method:req.method,route:req.route?.path||'unmatched',errorType:err.name,code:typeof err.code==='number'?err.code:undefined});
    const message=
        err.code === 11000
          ? "An account already uses that email."
          : err instanceof multer.MulterError
            ? "Upload one image up to 4 MB."
            : err.name === "CastError"
              ? "Invalid record identifier."
              : err.name==='VersionError'
                ? 'This record changed in another window. Reload it before saving.'
                : err.name==='ValidationError'
                  ? 'Some property fields are invalid. Check the form before saving.'
              : status >= 500
                ? "The service is temporarily unavailable. Please try again."
                : err.message;
    if(req.accepts(['html','json'])==='json')return res.status(status).json({message});
    res.status(status).render('error',{message});
  });
  return app;
}
if (require.main === module) {
  Promise.resolve().then(()=>{require('./lib/config').validateRuntime();require('./lib/config').validateEnvironment();return mongoose.connect(process.env.MONGO_URL || "mongodb://127.0.0.1:27017/nestly", {
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 20,
      minPoolSize: 2,
      socketTimeoutMS: 20000,
      autoIndex: process.env.NODE_ENV!=="production",
    });})
    .then(async () => {
      require('./lib/config').validateEnvironment();
      await require('./lib/health').readiness();
      const app = createApp();
      const server = app.listen(process.env.PORT || 8080, () =>
        console.log("PG Dekho listening on " + (process.env.PORT || 8080)),
      );
      let closing=false;
      const stop=()=>{if(closing)return;closing=true;const timer=setTimeout(()=>process.exit(1),20000);timer.unref();server.close(async()=>{try{if(app.locals.sessionStore)await app.locals.sessionStore.close();await mongoose.disconnect();clearTimeout(timer);process.exit(0);}catch{process.exit(1);}});};
      process.on('SIGTERM',stop);process.on('SIGINT',stop);
    })
    .catch(async (err) => {
      log('error','startup.failed',{errorType:err.name,message:err.name==='MongooseServerSelectionError'?'Database connection unavailable. Check configuration and network allowlist.':err.message?.replace(/mongodb[^\s]+/g,'[redacted URI]')});
      process.exitCode = 1;
      await mongoose.disconnect();
    });
}
module.exports = { createApp };
