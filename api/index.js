// Vercel serverless entry point.
// Vercel runs `buildCommand` (pnpm prisma generate && pnpm build) before this
// file is loaded, so dist/src/main.vercel.js exists by the time we require it.
// `includeFiles` in vercel.json ensures the dist/ output is bundled with the
// function, plus the Prisma client engine binaries.
module.exports = require('../dist/src/main.vercel').default;
