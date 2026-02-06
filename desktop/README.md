# OpenNotes Desktop

A cross-platform desktop application for browsing, editing, and managing educational notes offline. Built with [Tauri](https://tauri.app/), connecting to the [OpenNotes API](https://github.com/Tebby2008/OpenNotesAPI).

![OpenNotes Desktop](https://img.shields.io/badge/version-1.0.0-blue)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

## Features

- **Browse Notes**: Access the OpenNotes API to browse and search educational notes
- **Trending Notes**: View popular notes by subject and grade level
- **Built-in Editor**: Rich Markdown/LaTeX editor with:
  - Live preview with MathLive for equations
  - Mermaid.js diagram support
  - Syntax highlighting for code blocks
  - Tables, lists, and formatting tools
- **Offline Storage**: Save notes locally for offline access
- **Upload Tools**: Submit your own notes to the OpenNotes platform
- **Storage Management**: Monitor and manage your saved content

## Prerequisites

### All Platforms
- [Node.js](https://nodejs.org/) 18+ 
- [Rust](https://rustup.rs/) 1.77+

### Linux
```bash
sudo apt install libwebkit2gtk-4.1-dev libxdo-dev libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev
```

### macOS
Xcode Command Line Tools:
```bash
xcode-select --install
```

### Windows
- [Microsoft Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (pre-installed on Windows 11)

## Installation

```bash
# Clone the repository
git clone https://github.com/Tebby2008/OpenNotesDesktop.git
cd OpenNotesDesktop

# Install dependencies
npm install
```

## Development

```bash
# Start development server with hot reload
npm run tauri dev
```

## Building

```bash
# Build for production
npm run tauri build
```

Build outputs are located in `src-tauri/target/release/bundle/`:
- **Linux**: `.deb`, `.AppImage`
- **macOS**: `.dmg`, `.app`
- **Windows**: `.msi`, `.exe`

## Project Structure

```
OpenNotesDesktop/
├── index.html          # Main app HTML
├── src/
│   ├── main.js         # App logic (API, storage, editor, uploader)
│   └── styles/
│       └── main.css    # Complete design system
├── src-tauri/
│   ├── Cargo.toml      # Rust dependencies
│   ├── tauri.conf.json # Tauri configuration
│   ├── capabilities/   # Plugin permissions
│   └── src/
│       └── lib.rs      # Rust backend
└── package.json        # Node.js dependencies
```

## API Connection

OpenNotes Desktop connects to the OpenNotes API at:
```
https://open-notes.tebby2008-li.workers.dev
```

### Available Endpoints
- `GET /notes` - List all notes
- `GET /notes?id=<id>` - Get specific note
- `GET /trending?type=<all|subject|grade>` - Get trending notes
- `POST /notes` - Upload new note (requires Turnstile verification)

## Technologies

- **[Tauri 2.x](https://tauri.app/)** - Secure, lightweight desktop framework
- **[Vite](https://vitejs.dev/)** - Fast build tool
- **[MathLive](https://cortexjs.io/mathlive/)** - LaTeX equation rendering
- **[Mermaid](https://mermaid.js.org/)** - Diagram rendering
- **[Marked](https://marked.js.org/)** - Markdown parsing
- **[DOMPurify](https://github.com/cure53/DOMPurify)** - HTML sanitization

## License

MIT License - See [LICENSE](LICENSE) for details.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing`)
5. Open a Pull Request

## Related Projects

- [OpenNotesAPI](https://github.com/Tebby2008/OpenNotesAPI) - Backend API
- [OpenNotes](https://github.com/Tebby2008/OpenNotes) - Web interface
