# EvalFrame — AI Quality Lab

EvalFrame is a small local dashboard for checking how changes to a retrieval workflow affect its answers. It runs the same labelled support questions against two transparent search strategies, then shows retrieval metrics, unsupported-question handling and case-by-case regressions.

The sample knowledge base and evaluation cases are fictional. The benchmark is deliberately small and designed to make the mechanics easy to inspect. Its scores describe only this included dataset; they are not production performance claims or a measure of answer truth in general.

## Run locally

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:5056` in a browser. No external service or API key is needed. Stop the server with `Ctrl+C`.

## Use the dashboard

1. Choose how many ranked passages to inspect and the minimum evidence score.
2. Run the benchmark. EvalFrame evaluates a simple body-term baseline and a contextual ranker that also weights title, category and aliases.
3. Review Hit@k, reciprocal rank, precision, scenario pass rate and abstention accuracy.
4. Open a case to compare expected evidence with the retrieved passages. Regressions and improvements are judged against the baseline for that case.
5. Change the settings and run again to see how the threshold and result count affect this fixed set.

## How the evaluation works

- Each answerable case has one labelled expected source. A retrieval case passes when an expected source appears in the selected top-k results and the ranker's best score clears the configured threshold.
- Unsupported cases are expected to abstain. Abstention accuracy is the share of those cases for which the top score falls below the threshold.
- Mean reciprocal rank uses the position of the first expected source across the full ranking. Precision@k divides relevant retrieved sources by k, so its ceiling can be below 100% when a case has one relevant source and k is greater than one.
- Scenario pass rate combines answerable retrieval checks and unsupported-case abstention checks.
- The contextual strategy uses deterministic token overlap with fixed weights. Its score is a ranking heuristic, not a probability or confidence estimate.

The labels are hand-written examples, and a real evaluation needs representative, reviewed cases, more than one relevant source where appropriate, and checks for answer quality, citation correctness, latency and cost. This demo measures retrieval and a simple threshold-based abstention behaviour; it does not call a language model or grade generated prose.

## Project structure

```text
app.py                 Flask routes and benchmark calculations
data/knowledge.json    Fictional support articles
data/cases.json        Labelled queries and expected behaviour
templates/index.html   Dashboard structure
static/app.css         Responsive dashboard styles
static/app.js          Controls, rendering and benchmark requests
```

## Stack

Python, Flask, JSON, HTML, CSS and JavaScript. The app is local-first and does not send the dataset or queries to an external service.

