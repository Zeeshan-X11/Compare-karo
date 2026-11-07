require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/user");
(async () => {
  const email = process.argv[2];
  if (!email)
    throw Error(
      "Usage: npm run admin:promote -- owner@example.com (register first)",
    );
  await mongoose.connect(
    process.env.MONGO_URL || "mongodb://127.0.0.1:27017/nestly",
  );
  const user = await User.findOneAndUpdate(
    { email: email.trim().toLowerCase() },
    { $set: { role: "admin" }, $inc:{sessionVersion:1} },
    { new: true },
  );
  if (!user) throw Error("Register this account first.");
  await require('../models/audit-event').create({action:'admin.promote',entityType:'User',entityId:user._id,details:{operatorCommand:true}});
  console.log("Promoted account to administrator.");
})()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
