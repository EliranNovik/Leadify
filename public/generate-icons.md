# PWA Icon Generation Instructions

To create the required PWA icons, you need to generate multiple sizes from your Leadify logo.

## Required Icon Sizes

- 72x72.png
- 96x96.png
- 128x128.png
- 144x144.png
- 152x152.png
- 192x192.png
- 384x384.png
- 512x512.png

## Quick Method: Online Tools

1. **PWA Asset Generator** (Recommended):

   - Visit: https://www.pwabuilder.com/imageGenerator
   - Upload your `Leadify12.png` or `LeadifyLogo.jpeg`
   - Download the generated icons
   - Place them in the `/public` folder

2. **RealFaviconGenerator**:
   - Visit: https://realfavicongenerator.net/
   - Upload your logo
   - Configure settings and download
   - Extract the PNG files to `/public`

## Manual Method: Image Editor

1. Open your logo in an image editor (Photoshop, GIMP, Figma, etc.)
2. Create a square canvas (use the largest size needed: 512x512)
3. Center your logo on a transparent or solid background
4. Export at each required size:
   - 72x72
   - 96x96
   - 128x128
   - 144x144
   - 152x152
   - 192x192
   - 384x384
   - 512x512

## Using Command Line (ImageMagick)

If you have ImageMagick installed:

```bash
# Resize Leadify12.png to all required sizes
convert public/Leadify12.png -resize 72x72 public/icon-72x72.png
convert public/Leadify12.png -resize 96x96 public/icon-96x96.png
convert public/Leadify12.png -resize 128x128 public/icon-128x128.png
convert public/Leadify12.png -resize 144x144 public/icon-144x144.png
convert public/Leadify12.png -resize 152x152 public/icon-152x152.png
convert public/Leadify12.png -resize 192x192 public/icon-192x192.png
convert public/Leadify12.png -resize 384x384 public/icon-384x384.png
convert public/Leadify12.png -resize 512x512 public/icon-512x512.png
```

## Important Notes

- Icons should be square (1:1 aspect ratio)
- Use PNG format with transparency if your logo has it
- Ensure icons look good at small sizes (72x72)
- The 192x192 and 512x512 are the most important for Android
- iOS prefers 152x152 for home screen icons

## Temporary Solution

If you need to test the PWA immediately, you can temporarily use the existing logo for all sizes:

```bash
# Quick copy (not ideal but works for testing)
cp public/Leadify12.png public/icon-72x72.png
cp public/Leadify12.png public/icon-96x96.png
cp public/Leadify12.png public/icon-128x128.png
cp public/Leadify12.png public/icon-144x144.png
cp public/Leadify12.png public/icon-152x152.png
cp public/Leadify12.png public/icon-192x192.png
cp public/Leadify12.png public/icon-384x384.png
cp public/Leadify12.png public/icon-512x512.png
```
