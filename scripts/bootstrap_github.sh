#!/usr/bin/env bash
# One-shot GitHub bootstrap for SandBag.
# Prereqs: gh CLI authenticated (`gh auth login`), jq, run from the repo root.
# Usage: ./scripts/bootstrap_github.sh [owner] [repo]
#   owner defaults to "sandbagbeta" (create the org first at github.com/organizations/plan)
#   falls back cleanly if you pass your username instead.
set -euo pipefail

OWNER="${1:-sandbagbeta}"
REPO="${2:-sandbag}"
FULL="$OWNER/$REPO"
ISSUES_JSON="project/issues.json"

command -v gh >/dev/null || { echo "✗ install GitHub CLI: https://cli.github.com"; exit 1; }
command -v jq >/dev/null || { echo "✗ install jq (brew install jq)"; exit 1; }
gh auth status >/dev/null || { echo "✗ run: gh auth login"; exit 1; }
[ -f "$ISSUES_JSON" ] || { echo "✗ run from repo root ($ISSUES_JSON not found)"; exit 1; }

echo "==> Fetching AGPL-3.0 license text"
if [ ! -f LICENSE ]; then
  gh api /licenses/agpl-3.0 --jq .body > LICENSE
  echo "    wrote LICENSE"
fi

echo "==> Git init + first commit"
if [ ! -d .git ]; then git init -b main; fi
git add -A
git diff --cached --quiet || git commit -m "chore: initial scaffold — PRD, PLAN, agent workflow, repo config"

echo "==> Creating repo $FULL (public)"
if gh repo view "$FULL" >/dev/null 2>&1; then
  echo "    repo exists, skipping create"
else
  gh repo create "$FULL" --public --description "Open-source 3D boulder visualizer built on community contribution. Scan → annotate → climb." \
    --homepage "https://openbeta.io" --disable-wiki || {
      echo "✗ create failed. If the org doesn't exist yet: https://github.com/account/organizations/new (free plan)";
      echo "  or rerun with your username: ./scripts/bootstrap_github.sh <your-username>"; exit 1; }
fi

git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$FULL.git"
git push -u origin main

echo "==> Labels"
jq -c '.labels[]' "$ISSUES_JSON" | while read -r l; do
  name=$(jq -r .name <<<"$l"); color=$(jq -r .color <<<"$l"); desc=$(jq -r .description <<<"$l")
  gh label create "$name" --repo "$FULL" --color "$color" --description "$desc" --force >/dev/null && echo "    $name"
done

echo "==> Milestones"
jq -c '.milestones[]' "$ISSUES_JSON" | while read -r m; do
  title=$(jq -r .title <<<"$m"); desc=$(jq -r .description <<<"$m")
  gh api "repos/$FULL/milestones" -f title="$title" -f description="$desc" >/dev/null 2>&1 \
    && echo "    $title" || echo "    $title (exists)"
done

echo "==> Issues"
# map milestone title -> number
MS=$(gh api "repos/$FULL/milestones?state=all" --jq 'map({(.title): .number}) | add')
COUNT=$(jq '.issues | length' "$ISSUES_JSON")
for i in $(seq 0 $((COUNT-1))); do
  title=$(jq -r ".issues[$i].title" "$ISSUES_JSON")
  body=$(jq -r ".issues[$i].body" "$ISSUES_JSON")
  ms_title=$(jq -r ".issues[$i].milestone" "$ISSUES_JSON")
  labels=$(jq -r ".issues[$i].labels | join(\",\")" "$ISSUES_JSON")
  ms_num=$(jq -r --arg t "$ms_title" '.[$t]' <<<"$MS")
  gh api "repos/$FULL/issues" -f title="$title" -f body="$body" -F milestone="$ms_num" \
    $(IFS=','; for lab in $labels; do printf -- '-f labels[]=%q ' "$lab"; done) >/dev/null
  echo "    #$((i+1)) $title"
  sleep 1  # stay friendly with secondary rate limits
done

echo "==> Branch protection on main (PRs + CI required, squash only)"
gh api -X PUT "repos/$FULL/branches/main/protection" \
  -F required_status_checks.strict=true -f 'required_status_checks.contexts[]=checks' \
  -F enforce_admins=false \
  -F required_pull_request_reviews.required_approving_review_count=0 \
  -F restrictions=null >/dev/null 2>&1 || echo "    (skipped — needs admin; set in repo Settings → Branches)"
gh api -X PATCH "repos/$FULL" -F allow_squash_merge=true -F allow_merge_commit=false \
  -F allow_rebase_merge=false -F delete_branch_on_merge=true >/dev/null

cat <<EOF

✅ Done: https://github.com/$FULL

Next (manual, ~5 min):
  1. Claude GitHub app for @claude-on-issues + PR review agent:
       in any Claude Code terminal run: /install-github-app
       (or https://github.com/apps/claude — install on $OWNER, select $REPO)
  2. Connect the repo in claude.ai → Settings → GitHub so cloud sessions can open PRs.
  3. Vercel: import the repo (framework: Next.js) once issue #1 lands.
  4. Supabase: create the cloud project when you start issue #2.
EOF
