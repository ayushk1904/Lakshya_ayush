"""Deploys one service folder to its Hugging Face Docker Space (created on first run).

Usage: python deploy_space.py <folder> <space-name> <title> <SECRET_NAMES,...> [VARIABLE_NAMES,...]
Needs HF_TOKEN (a Hugging Face token with write access). Secrets and variables are copied from
the environment into the Space's settings, so they are managed in one place: GitHub.
"""

import os
import shutil
import sys
import tempfile
from pathlib import Path

from huggingface_hub import HfApi

folder, space, title, secret_names = sys.argv[1:5]
variable_names = sys.argv[5] if len(sys.argv) > 5 else ""

api = HfApi(token=os.environ["HF_TOKEN"])
owner = api.whoami()["name"]
repo_id = f"{owner}/{space}"
api.create_repo(repo_id, repo_type="space", space_sdk="docker", exist_ok=True)

for name in filter(None, secret_names.split(",")):
    if os.getenv(name):
        api.add_space_secret(repo_id, name, os.environ[name])
for name in filter(None, variable_names.split(",")):
    if os.getenv(name):
        api.add_space_variable(repo_id, name, os.environ[name])

# Spaces read their settings from front matter at the top of README.md.
front_matter = (
    f"---\ntitle: {title}\nemoji: 🎯\ncolorFrom: blue\ncolorTo: indigo\n"
    "sdk: docker\napp_port: 7860\npinned: false\n---\n\n"
)
with tempfile.TemporaryDirectory() as staging:
    shutil.copytree(
        folder,
        staging,
        dirs_exist_ok=True,
        ignore=shutil.ignore_patterns(".venv", "__pycache__", ".cache", ".env", "*.log", "scripts"),
    )
    readme = Path(staging, "README.md")
    body = readme.read_text(encoding="utf-8") if readme.exists() else ""
    readme.write_text(front_matter + body, encoding="utf-8")
    api.upload_folder(
        folder_path=staging,
        repo_id=repo_id,
        repo_type="space",
        commit_message=f"Deploy {os.getenv('GITHUB_SHA', 'local')[:7]}",
    )

subdomain = f"{owner}-{space}".lower().replace("_", "-").replace(".", "-")
print(f"Deployed {repo_id}: https://{subdomain}.hf.space")
