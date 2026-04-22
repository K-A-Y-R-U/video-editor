# Cómo empaquetar ffmpeg y yt-dlp en la app

La app busca los binarios en esta estructura:

```
video-editor/
├── bin/
│   ├── linux/
│   │   ├── ffmpeg
│   │   ├── ffprobe
│   │   └── yt-dlp
│   ├── win/
│   │   ├── ffmpeg.exe
│   │   ├── ffprobe.exe
│   │   └── yt-dlp.exe
│   └── mac/
│       ├── ffmpeg
│       ├── ffprobe
│       └── yt-dlp
```

## Descargar los binarios

### ffmpeg + ffprobe
- https://ffmpeg.org/download.html
- Descargar la versión estática para cada plataforma

### yt-dlp
- https://github.com/yt-dlp/yt-dlp/releases
- Descargar `yt-dlp` (Linux/Mac) o `yt-dlp.exe` (Windows)

## En Linux (desarrollo)
```bash
mkdir -p bin/linux
# ffmpeg
wget https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
tar xf ffmpeg-release-amd64-static.tar.xz
cp ffmpeg-*/ffmpeg ffmpeg-*/ffprobe bin/linux/
# yt-dlp
wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O bin/linux/yt-dlp
chmod +x bin/linux/*
```

## Empaquetar la app
```bash
npm install
npm run build:linux    # genera AppImage y .deb
npm run build:windows  # genera instalador .exe
npm run build:mac      # genera .dmg
```

Los binarios quedan dentro del instalador y la app los encuentra automáticamente sin que el usuario instale nada.