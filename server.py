#!/usr/bin/env python3
"""Simple Flask server to serve the AI4P dashboard on port 8080."""
from flask import Flask, send_from_directory
from pathlib import Path

app = Flask(__name__)
DASHBOARD_DIR = Path(__file__).parent

@app.route("/")
def index():
    return send_from_directory(DASHBOARD_DIR, "index.html")

@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(DASHBOARD_DIR, filename)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, debug=False)
