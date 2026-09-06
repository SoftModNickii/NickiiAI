#!/usr/bin/env python3
"""
Nickii AI - Video Loop Server

A simple HTTP server to serve the video loop files for testing and deployment.

Usage:
    python3 scripts/serve-video-loop.py [port]
    
    Default port: 8000

This starts a web server that serves files from the public/ directory,
allowing you to access video-loop.html and your video files from the iPad.

Example:
    On Mac: python3 scripts/serve-video-loop.py 8000
    On iPad: Open Safari and go to http://MAC-IP:8000/video-loop.html

To find your Mac's IP address:
    ipconfig getifaddr en0  (Wi-Fi)
    ipconfig getifaddr en1  (Ethernet)
"""

import os
import sys
import socket
import threading
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

# Project root
REPO = Path(__file__).parent.parent
PUBLIC_DIR = REPO / "public"

class VideoLoopHandler(SimpleHTTPRequestHandler):
    """Custom handler that serves files from the public directory."""
    
    def __init__(self, *args, **kwargs):
        # Change to public directory
        os.chdir(PUBLIC_DIR)
        super().__init__(*args, **kwargs)
    
    def do_GET(self):
        """Serve files, with special handling for video-loop.html"""
        # If root, redirect to video-loop.html
        if self.path == "/" or self.path == "/index.html":
            self.send_response(302)
            self.send_header("Location", "/video-loop.html")
            self.end_headers()
            return
        
        # Serve the file normally
        super().do_GET()
    
    def log_message(self, format, *args):
        """Suppress log messages by default, but allow with -v flag"""
        if "-v" in sys.argv or "--verbose" in sys.argv:
            sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), format % args))

def get_local_ip():
    """Get the local IP address of the Mac."""
    try:
        # Try to get Wi-Fi interface first
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def print_banner(port, ip):
    """Print a nice banner with connection instructions."""
    print()
    print("=" * 60)
    print("  NICKII AI - Video Loop Server")
    print("=" * 60)
    print()
    print(f"  Server running on: http://{ip}:{port}/")
    print()
    print("  To connect from iPad:")
    print(f"    1. Open Safari on your iPad")
    print(f"    2. Enter this URL: http://{ip}:{port}/video-loop.html")
    print()
    print("  Or use these direct links:")
    print(f"    - Main page: http://{ip}:{port}/")
    print(f"    - Video loop: http://{ip}:{port}/video-loop.html")
    print()
    print("  To stop the server: Press Ctrl+C")
    print()
    print("  Note: Make sure your iPad and Mac are on the same network")
    print("=" * 60)
    print()

def check_video_file():
    """Check if video-loop.html exists."""
    video_loop = PUBLIC_DIR / "video-loop.html"
    if video_loop.exists():
        print(f"  ✓ video-loop.html found")
        return True
    else:
        print(f"  ✗ video-loop.html NOT found in {PUBLIC_DIR}")
        print(f"  Run: cp {REPO}/public/client.html {PUBLIC_DIR}/video-loop.html")
        return False

def main():
    # Parse command line arguments
    port = 8000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print("Invalid port number")
            sys.exit(1)
    
    # Get local IP
    local_ip = get_local_ip()
    
    # Check if video-loop.html exists
    print("Checking files...")
    if not check_video_file():
        print("\nCannot start server without video-loop.html")
        sys.exit(1)
    
    # Check for video files
    video_files = list(PUBLIC_DIR.glob("*.mp4")) + list(PUBLIC_DIR.glob("*.webm"))
    if video_files:
        print(f"  ✓ Found {len(video_files)} video file(s):")
        for vf in video_files:
            print(f"    - {vf.name}")
    else:
        print(f"  ⚠ No video files found in {PUBLIC_DIR}")
        print(f"  Add your video file (e.g., nickii-loop.mp4) to this directory")
    
    print()
    
    # Print banner
    print_banner(port, local_ip)
    
    # Start server
    try:
        server = HTTPServer(("", port), VideoLoopHandler)
        print(f"Starting server on port {port}...\n")
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n\nServer stopped.")
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
