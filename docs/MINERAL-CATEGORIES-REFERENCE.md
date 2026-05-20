# Mineral categories reference (Buy screen)

Use these **Category** and **Sub-category** values when creating/importing minerals so the app Buy screen shows:

**Category** → **Sub-category** → **Items**

## 1. Precious Metal
- **Gold** – Gold Biscuit, Gold Bullion Bars, Gold Concentrate, Gold Dore Bars, Gold Dust, Gold Flakes, Gold Nuggets, Gold Powder, Gold Small Hand Poured Collector Bars, Grain Shot, Sponge Gold
- **Platinum** – Platinum Bar, Platinum Grains, Platinum Nugget
- **Silver** – Raw Silver Ore, Silver Bar, Silver Crystals, Silver Flakes, Silver Grain

## 2. Gemstone
- **Alexandrite**, **Benitoite**, **Black Opal**, **Diamond** (Diamond Bort, Diamond Grit, Diamond Powder), **Emerald**, **Fire Opal**, **Grandidierite**, **Jadeite**, **Jeremejevite**, **Musgravite**, **Poudretteite**, **Red Beryl**, **Ruby**, **Serendibite**, **Silica Sand** (Silica Ore), **Taaffeite**, **Tanzanite**

## 3. Industrial Mineral
- **Dolomite**, **Kyanite**, **Mica**, **Limestone**, **Vermiculite**, **Quartz & Feldspar**, **Silica Sand**, **Granite**, **Gypsum**, **Iron**, **Magnesite**, **Soapstone (Talc)**, **Sulphur**

## 4. Critical Mineral
- **Aluminum**, **Bauxite**, **Chromite**, **Cobalt**, **Copper**, **Manganese**, **Vanadium**, **Graphite**, **Lithium**, **Nickel**, **Phosphate**, **Tungsten**, **Zinc**

## 5. Energy Mineral
- **Lignite**

---

**Data shape:** Each mineral record should have:
- `name` – e.g. "Gold Biscuit", "Diamond Grit"
- `category` – one of: `Precious Metal` / `Precious metals`, `Gemstone`, `Industrial Mineral`, `Critical Mineral`, `Energy Mineral`
- `subCategory` – e.g. `Gold`, `Platinum`, `Silver`, `Diamond`, `Dolomite`, `Aluminum`, `Lignite`

The app groups by **category** then **subCategory** and shows: Category name → sub-category tiles → tap opens that sub-category’s items only.
