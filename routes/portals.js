const {audit}=require('../lib/audit');
const {problem}=require('../lib/errors');
const mongoose = require("mongoose");
const Listing = require("../models/listing"),
  User = require("../models/user");
const publication = require("../lib/publication"),
  market = require("../lib/marketplace");
const { scalar } = require("../lib/filters");
const directory = require("../lib/directory");
const { photoTypes } = require("../lib/photos");
const oid = (v) => new mongoose.Types.ObjectId(v);
const safeReturn = (value, fallback) =>
  typeof value === "string" &&
  /^\/(favorites|compare|listings(?:\/[a-f0-9]{24})?)$/.test(value)
    ? value
    : fallback;
function registerPortalRoutes({ app, auth, role, wrap, actionLimit, owned }) {
  app.get(
    "/favorites",
    auth,
    wrap(async (req, res) => {
      const page = market.page(req.query.page);
      const { listings, total } = await publication.findPublic(
        {
          _id: { $in: market.objectIds(req.user.favorites) },
          listingStatus: "published",
        },
        { createdAt: -1 },
        page,
      );
      const directoryEntries = await directory.saved(req.user.directoryFavorites || []);
      res.render("favorites", {
        listings,
        directoryEntries,
        page,
        pages: Math.ceil(total / 12),
        total,
        unavailable: (await publication.findPublic({_id:{$in:market.objectIds(req.user.favorites)},listingStatus:'published'},{createdAt:-1},1,100)).listings.map(l=>String(l._id)),
      });
    }),
  );
  app.post(
    "/favorites/:id",
    auth,
    wrap(async (req, res) => {
      const id = oid(req.params.id);
      if (!["add", "remove"].includes(req.body.action))
        throw problem(400,"Choose add or remove.");
      if (req.body.action === "remove")
        await User.updateOne(
          { _id: req.user._id },
          { $pull: { favorites: id } },
        );
      else {
        if (!(await publication.getPublic(id))) return res.sendStatus(404);
        const saved = await User.updateOne(
          {
            _id: req.user._id,
            $or: [
              { favorites: id },
              {
                $expr: {
                  $lt: [{ $size: { $ifNull: ["$favorites", []] } }, 100],
                },
              },
            ],
          },
          { $addToSet: { favorites: id } },
        );
        if (!saved.matchedCount)
          throw problem(400,
            "You can save up to 100 PGs. Remove one before saving another.",
          );
      }
      res.redirect(safeReturn(req.body.returnTo, "/favorites"));
    }),
  );
  app.post(
    "/favorites/directory/:id",
    auth,
    wrap(async (req, res) => {
      const id = oid(req.params.id);
      const { action, returnTo } = req.body;
      if (action === "remove") {
        await User.updateOne({ _id: req.user._id }, { $pull: { directoryFavorites: id } });
      } else if (action === "add") {
        if (!(await directory.exists(id))) return res.sendStatus(404);
        const result = await User.updateOne(
          {
            _id: req.user._id,
            $or: [
              { directoryFavorites: id },
              { $expr: { $lt: [{ $size: { $ifNull: ["$directoryFavorites", []] } }, 100] } },
            ],
          },
          { $addToSet: { directoryFavorites: id } },
        );
        if (!result.matchedCount) throw problem(400, "Remove a directory PG before saving another.");
      } else {
        throw problem(400, "Choose add or remove.");
      }
      if (req.accepts(["html", "json"]) === "json") return res.json({ saved: action === "add" });
      res.redirect(returnTo === "/directory/rajanukunte" ? returnTo : safeReturn(returnTo, "/favorites"));
    }),
  );
  app.get(
    "/compare",
    wrap(async (req, res) => {
      const ids = market.objectIds(req.session.comparison);
      const { listings } = await publication.findPublic(
        { _id: { $in: ids }, listingStatus: "published" },
        { createdAt: -1 },
        1,
        3,
      );
      req.session.comparison=listings.map(l=>String(l._id));
      res.locals.compareIds=new Set(req.session.comparison);
      res.render("compare", { listings });
    }),
  );
  app.post(
    "/compare/:id",
    wrap(async (req, res) => {
      const visible=await publication.findPublic({_id:{$in:market.objectIds(req.session.comparison)},listingStatus:'published'},{createdAt:-1},1,3);
      const ids=visible.listings.map(l=>String(l._id));
      if (req.body.action === "remove")
        req.session.comparison = ids.filter((id) => id !== req.params.id);
      else if (req.body.action === "add") {
        if (!(await publication.getPublic(req.params.id)))
          return res.sendStatus(404);
        if (!ids.includes(req.params.id)) {
          if (ids.length >= 3)
            throw problem(400,
              "Compare up to 3 PGs at a time. Remove one to add another.",
            );
          ids.push(req.params.id);
        }
        req.session.comparison = ids;
      } else throw problem(400,"Choose add or remove.");
      res.redirect(safeReturn(req.body.returnTo, "/compare"));
    }),
  );
  app.get(
    "/listings/:id/contact/:method",
    actionLimit,
    wrap(async (req, res) => {
      const listing = await publication.getPublic(req.params.id);
      if (!listing) return res.sendStatus(404);
      const number = market.phone(listing.contactPhone);
      if (!listing.contactPublic || !number)
        return res
          .status(403)
          .render("error", {
            message:
              "Public contact is not authorized for this property. Send an inquiry instead.",
          });
      if (!["call", "whatsapp"].includes(req.params.method))
        return res.sendStatus(404);
      if (req.params.method === "whatsapp" && !listing.whatsappAllowed)
        return res
          .status(403)
          .render("error", {
            message: "This owner has not authorized WhatsApp contact.",
          });
      await Listing.updateOne(
        { _id: listing._id },
        { $inc: { "statistics.contactClicks": 1 } },
      );
      res.redirect(
        req.params.method === "call"
          ? "tel:" + number
          : "https://wa.me/" +
              number.slice(1) +
              "?text=" +
              encodeURIComponent(
                "Hello, I am interested in " +
                  listing.name +
                  " on PG Dekho. Could you confirm room availability and rent?",
              ),
      );
    }),
  );
  app.post(
    "/owner/:id/photos/:photoId/manage",
    auth,
    role(["owner", "admin"]),
    wrap(async (req, res) => {
      const l = await owned(req);
      if (!mongoose.isValidObjectId(req.params.photoId))
        return res.sendStatus(404);
      const image = l.images.id(req.params.photoId);
      if (!image) return res.sendStatus(404);
      publication.preservePublished(l);
      if (!photoTypes.includes(req.body.type))
        throw problem(400,"Choose a valid photograph type.");
      image.type = req.body.type;
      image.status = "pending";
      if (req.body.cover === "yes") {
        if (image.type !== "Exterior")
          throw problem(400,"Only a building exterior photo can be the cover.");
        l.coverImageId = image._id;
      }
      l.listingStatus = "draft";
      await l.save();
      await audit(req,'property.photo.manage','Listing',l._id,{photoId:req.params.photoId,type:image.type});
      res.redirect("/owner/" + l._id + "/edit?saved=1");
    }),
  );
  app.get(
    "/admin/owners",
    auth,
    role(["admin"]),
    wrap(async (req, res) => {
      const page = market.page(req.query.page);
      const query = { role: "owner" };
      if (req.query.state === "suspended") query.suspended = true;
      const [owners, total] = await Promise.all([
        User.find(query)
          .select(
            "name email suspended suspensionReason identityStatus identityNotes createdAt",
          )
          .sort({ createdAt: -1 })
          .skip((page - 1) * 20)
          .limit(20)
          .lean(),
        User.countDocuments(query),
      ]);
      const counts = await Listing.aggregate([
        { $match: { ownerId: { $in: owners.map((o) => o._id) } } },
        { $group: { _id: "$ownerId", count: { $sum: 1 } } },
      ]);
      for (const owner of owners)
        owner.listingCount =
          counts.find((c) => String(c._id) === String(owner._id))?.count || 0;
      res.render("owners", { owners, page, pages: Math.ceil(total / 20) });
    }),
  );
  app.post(
    "/admin/owners/:id/state",
    auth,
    role(["admin"]),
    wrap(async (req, res) => {
      if (!["suspend", "restore"].includes(req.body.action))
        throw problem(400,"Choose suspend or restore.");
      const reason = scalar(req.body.reason);
      if (reason.length < 10 || reason.length > 1000)
        throw problem(400,"Record a reason of 10–1000 characters.");
      const owner = await User.findOne({ _id: req.params.id, role: "owner" });
      if (!owner) return res.sendStatus(404);
      owner.suspended = req.body.action === "suspend";
      owner.sessionVersion=(owner.sessionVersion||0)+1;
      owner.suspensionReason = reason;
      owner.suspendedAt = owner.suspended ? new Date() : null;
      await owner.save();
      await audit(req,"owner."+req.body.action,"User",owner._id,{reason});
      await Listing.updateMany(
        { ownerId: owner._id },
        { $set: { ownerSuspended: owner.suspended } },
      );
      res.redirect("/admin/owners");
    }),
  );
  app.post(
    "/admin/owners/:id/identity",
    auth,
    role(["admin"]),
    wrap(async (req, res) => {
      const notes = scalar(req.body.notes);
      if (
        !["unreviewed", "reviewed"].includes(req.body.status) ||
        notes.length < 20 ||
        notes.length > 1500
      )
        throw problem(400,
          "Choose a review state and record at least 20 characters of evidence notes.",
        );
      const result = await User.updateOne(
        { _id: req.params.id, role: "owner" },
        { $set: { identityStatus: req.body.status, identityNotes: notes } },
      );
      if (!result.matchedCount) return res.sendStatus(404);
      await audit(req,"owner.identity","User",req.params.id,{state:req.body.status});
      res.redirect("/admin/owners");
    }),
  );
  app.post(
    "/admin/:id/verification",
    auth,
    role(["admin"]),
    wrap(async (req, res) => {
      const listing = await Listing.findById(req.params.id);
      if (!listing) return res.sendStatus(404);
      const method = scalar(req.body.method),
        notes = scalar(req.body.notes);
      if (!["unverified", "documents", "site-visit"].includes(method))
        throw problem(400,"Choose a verification method.");
      if (notes.length < 20 || notes.length > 2000)
        throw problem(400,"Record 20–2000 characters describing evidence and scope.");
      const performedAt =
        method === "unverified"
          ? null
          : market.dateInput(scalar(req.body.performedAt), "Verification date");
      if (method !== "unverified" && !performedAt)
        throw problem(400,"Record the date the check was actually performed.");
      listing.verification = {
        method,
        notes,
        performedAt,
        recordedBy: req.user._id,
      };
      listing.propertyVerificationStatus =
        method === "unverified"
          ? "unverified"
          : method === "documents"
            ? "documents-reviewed"
            : "site-visit-recorded";
      if(listing.listingStatus==='published'&&publication.live(listing)&&listing.publicSnapshot){listing.publicSnapshot.verification={method,performedAt};listing.publicSnapshot.propertyVerificationStatus=listing.propertyVerificationStatus;listing.markModified('publicSnapshot');}
      listing.moderationHistory.push({
        action: "verification:" + method,
        notes,
        actorId: req.user._id,
        at: new Date(),
      });
      await listing.save();
      await audit(req,"property.verification","Listing",listing._id,{method});
      res.redirect("/admin/" + listing._id);
    }),
  );
  app.post(
    "/admin/:id/reports/:reportId",
    auth,
    role(["admin"]),
    wrap(async (req, res) => {
      const l = await Listing.findById(req.params.id);
      if (!l || !mongoose.isValidObjectId(req.params.reportId))
        return res.sendStatus(404);
      const report = l.reports.id(req.params.reportId);
      if (!report) return res.sendStatus(404);
      const resolution = scalar(req.body.resolution);
      if (
        !["resolved", "dismissed"].includes(req.body.status) ||
        resolution.length < 10 ||
        resolution.length > 1500
      )
        throw problem(400,
          "Choose a report outcome and record a reason of 10–1500 characters.",
        );
      report.status = req.body.status;
      report.resolution = resolution;
      report.reviewedBy = req.user._id;
      report.reviewedAt = new Date();
      await l.save();
      await audit(req,"report.resolve","Listing",l._id,{reportId:String(report._id),state:report.status,reason:resolution});
      res.redirect("/admin/" + l._id);
    }),
  );
}
module.exports = { registerPortalRoutes };
