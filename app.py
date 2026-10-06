"""EvalFrame: a small, deterministic quality bench for retrieval workflows."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from flask import Flask, jsonify, render_template, request

ROOT = Path(__file__).parent
app = Flask(__name__)
DOCUMENTS = json.loads((ROOT / "data" / "knowledge.json").read_text(encoding="utf-8"))
CASES = json.loads((ROOT / "data" / "cases.json").read_text(encoding="utf-8"))
STOP_WORDS = {
    "about", "after", "again", "also", "and", "any", "are", "can", "could",
    "for", "from", "have", "help", "how", "into", "just", "need", "our",
    "please", "should", "that", "the", "their", "them", "there", "this",
    "what", "when", "where", "which", "with", "would", "you", "your",
}


def terms(text: str) -> list[str]:
    """Tokenise text consistently; scores are heuristics, never probabilities."""
    return [word for word in re.findall(r"[a-z0-9]+", text.casefold()) if len(word) > 2 and word not in STOP_WORDS]


def rank_documents(query: str, strategy: str) -> list[dict]:
    query_terms = set(terms(query))
    if not query_terms:
        return []

    ranked = []
    for doc in DOCUMENTS:
        body = set(terms(doc["body"]))
        title = set(terms(doc["title"]))
        category = set(terms(doc["category"]))
        aliases = set(terms(" ".join(doc.get("aliases", []))))

        if strategy == "contextual":
            raw = sum(
                (1.0 if term in body else 0.0)
                + (1.25 if term in title else 0.0)
                + (0.8 if term in category else 0.0)
                + (0.9 if term in aliases else 0.0)
                for term in query_terms
            )
            score = min(1.0, raw / (len(query_terms) * 2.0))
        else:
            score = len(query_terms & body) / len(query_terms)

        if score > 0:
            ranked.append((score, doc))

    ranked.sort(key=lambda item: (-item[0], item[1]["id"]))
    return [
        {"id": doc["id"], "title": doc["title"], "category": doc["category"], "score": round(score, 4), "body": doc["body"]}
        for score, doc in ranked
    ]


def evaluate(strategy: str, top_k: int, threshold: float) -> dict:
    answerable = [case for case in CASES if not case["should_abstain"]]
    hits, reciprocal_ranks, precisions = [], [], []
    abstention_checks, passed = [], 0
    rows = []

    for case in CASES:
        ranked = rank_documents(case["query"], strategy)
        expected = set(case["expected_sources"])
        visible = ranked[:top_k]
        best_score = ranked[0]["score"] if ranked else 0.0
        abstained = best_score < threshold

        if case["should_abstain"]:
            correct = abstained
            abstention_checks.append(correct)
        else:
            order = [item["id"] for item in ranked]
            matching_positions = [index + 1 for index, doc_id in enumerate(order) if doc_id in expected]
            hit = bool(matching_positions and matching_positions[0] <= top_k and not abstained)
            hits.append(hit)
            reciprocal_ranks.append(1 / matching_positions[0] if matching_positions else 0.0)
            precisions.append(len(expected & {item["id"] for item in visible}) / max(top_k, 1))
            correct = hit

        passed += int(correct)
        rows.append({
            "id": case["id"],
            "group": case["group"],
            "query": case["query"],
            "expected_sources": case["expected_sources"],
            "should_abstain": case["should_abstain"],
            "abstained": abstained,
            "best_score": round(best_score, 4),
            "pass": correct,
            "ranked": visible,
            "note": case["note"],
        })

    mean = lambda values: round(sum(values) / len(values) * 100, 1) if values else 0.0
    return {
        "strategy": strategy,
        "top_k": top_k,
        "threshold": round(threshold, 2),
        "metrics": {
            "scenario_pass_rate": mean([row["pass"] for row in rows]),
            "hit_at_k": mean(hits),
            "mrr": round(sum(reciprocal_ranks) / len(reciprocal_ranks) * 100, 1) if reciprocal_ranks else 0.0,
            "precision_at_k": mean(precisions),
            "abstention_accuracy": mean(abstention_checks),
            "total_cases": len(CASES),
            "answerable_cases": len(answerable),
            "abstention_cases": len(CASES) - len(answerable),
            "passed_cases": passed,
        },
        "cases": rows,
    }


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/bench")
def bench():
    groups = {}
    for case in CASES:
        groups[case["group"]] = groups.get(case["group"], 0) + 1
    return jsonify({
        "case_count": len(CASES),
        "documents": DOCUMENTS,
        "groups": [{"name": name, "count": count} for name, count in sorted(groups.items())],
    })


@app.post("/api/run")
def run_benchmark():
    payload = request.get_json(silent=True) or {}
    try:
        top_k = int(payload.get("top_k", 3))
        threshold = float(payload.get("threshold", 0.1))
    except (TypeError, ValueError):
        return jsonify({"error": "Choose a valid result count and evidence threshold."}), 400

    if top_k not in (1, 3, 5) or not 0 <= threshold <= 0.5:
        return jsonify({"error": "Result count or evidence threshold is outside the supported range."}), 400

    baseline = evaluate("baseline", top_k, threshold)
    contextual = evaluate("contextual", top_k, threshold)
    baseline_by_id = {case["id"]: case for case in baseline["cases"]}
    for case in contextual["cases"]:
        before = baseline_by_id[case["id"]]["pass"]
        case["change"] = "steady" if before == case["pass"] else ("regression" if before else "improved")

    return jsonify({"case_count": len(CASES), "baseline": baseline, "contextual": contextual})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5056")), debug=False)

