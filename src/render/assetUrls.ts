// Content-hashed asset URLs (report-playtest1 §6.21, spec-build2 §6.8): the
// game's own assets live in src/assets/ and are imported with Vite `?url`, so
// a build emits assets/world-<hash>.png etc. and a Pages redeploy can never
// pair a new bundle with a cached old atlas. vite.config.ts keeps
// assetsInlineLimit 0 (never a data: URI). This is the only module with `?url`
// imports; PreloadScene loads everything listed here. Writers: tools/art/
// atlas.ts (world.*, interior.*), tools/art/font.ts (m5x7.xml), tools/art/
// logo.ts (logo.png), tools/fixtures/attract.ts (attract.json).
import attractJson from '../assets/attract.json?url'
import interiorJson from '../assets/interior.json?url'
import interiorPng from '../assets/interior.png?url'
import logoPng from '../assets/logo.png?url'
import fontXml from '../assets/m5x7.xml?url'
import worldJson from '../assets/world.json?url'
import worldPng from '../assets/world.png?url'

export const WORLD_PNG_URL: string = worldPng
export const WORLD_JSON_URL: string = worldJson
export const INTERIOR_PNG_URL: string = interiorPng
export const INTERIOR_JSON_URL: string = interiorJson
export const FONT_XML_URL: string = fontXml
export const LOGO_URL: string = logoPng
export const ATTRACT_URL: string = attractJson
