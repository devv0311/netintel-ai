#!/usr/bin/env python3
"""
Build the NetIntel AI source registry.

Single source of truth for Phase 1 source assessment. Emits:
  docs/data-research/source-registry.csv       (full 44-column registry)
  docs/data-research/_generated_tables.md      (markdown fragments)

Every license field must trace to a primary URL recorded in license_url.
Anything unverified is marked MANUAL_REVIEW, never APPROVED.
"""

import csv
import os

# Task-fit scoring, 0-3, against NetIntel AI's actual ML tasks:
#   er  = entity resolution            ner = entity extraction
#   re  = relationship extraction      ee  = event extraction
#   tmp = temporal reasoning           geo = spatial reasoning
#   con = contradiction detection      gra = graph construction
#   rpt = grounded investigative reporting
#
#   3 = direct supervision or gold structure for this task
#   2 = usable after transformation / weak supervision
#   1 = indirect (pretraining or context only)
#   0 = no meaningful contribution
TASKS = ["er", "ner", "re", "ee", "tmp", "geo", "con", "gra", "rpt"]

FIELDS = [
    "source_id", "source_name", "publisher", "source_type", "official_url",
    "dataset_url", "api_url", "description", "data_type", "relevance",
    "granularity", "temporal_coverage", "geographic_coverage", "access_method",
    "authentication_required", "rate_limit", "robots_or_access_policy",
    "license", "license_url", "training_use", "redistribution",
    "attribution_required", "third_party_content", "pii_risk", "copyright_risk",
    "provenance_quality", "freshness", "collection_complexity",
    "quality_score", "legal_score", "privacy_score", "overall_score",
] + ["task_" + t for t in TASKS] + [
    "task_total", "tier", "status", "manual_review_required", "notes",
]

S = []


def add(**kw):
    kw.setdefault("manual_review_required", "NO")
    kw["task_total"] = sum(kw.get("task_" + t, 0) for t in TASKS)
    S.append(kw)


# ---------------------------------------------------------------- TIER A ----

add(
    source_id="SRC-001", source_name="Wikidata", publisher="Wikimedia Foundation",
    source_type="structured knowledge base",
    official_url="https://www.wikidata.org/",
    dataset_url="https://dumps.wikimedia.org/wikidatawiki/entities/",
    api_url="https://query.wikidata.org/sparql",
    description="Collaboratively edited knowledge graph of ~110M items with typed statements, qualifiers, references, coordinates, temporal qualifiers and ~7000 external identifier properties.",
    data_type="entities, relationships, identifiers, coordinates, temporal qualifiers",
    relevance="Primary source of free entity-resolution supervision and graph structure.",
    granularity="entity / statement", temporal_coverage="historic to present",
    geographic_coverage="global (strong India coverage for people, orgs, places)",
    access_method="bulk dump (JSON/TTL) + SPARQL endpoint + REST API",
    authentication_required="NO",
    rate_limit="WDQS: 60s query timeout, concurrency limits, 429 backoff required; descriptive User-Agent mandatory",
    robots_or_access_policy="Wikimedia User-Agent policy; use dumps for large result sets, not WDQS",
    license="CC0 1.0", license_url="https://www.wikidata.org/wiki/Wikidata:Data_access",
    training_use="YES", redistribution="YES", attribution_required="NO (appreciated)",
    third_party_content="references point to external sources; the statements themselves are CC0",
    pii_risk="LOW-MEDIUM (living persons; notability-gated, already public)",
    copyright_risk="LOW", provenance_quality="HIGH (statement-level references, revision IDs)",
    freshness="continuous", collection_complexity="LOW-MEDIUM (dump size)",
    quality_score=8, legal_score=10, privacy_score=8, overall_score=9,
    task_er=3, task_ner=2, task_re=3, task_ee=2, task_tmp=3, task_geo=3,
    task_con=1, task_gra=3, task_rpt=1,
    tier="A", status="APPROVED",
    notes="THE anchor source. External-ID properties and sitelinks yield match/non-match pairs for entity resolution at zero labelling cost - this is the single strongest argument for it, not that it is 'real world'. Qualifiers P580/P582/P585 give temporal validity; P625 gives coordinates. Use dumps, never bulk-crawl WDQS.",
)

add(
    source_id="SRC-002", source_name="GLEIF LEI (Level 1 + Level 2)",
    publisher="Global Legal Entity Identifier Foundation",
    source_type="official entity registry",
    official_url="https://www.gleif.org/en/lei-data/gleif-golden-copy",
    dataset_url="https://www.gleif.org/en/lei-data/gleif-golden-copy/download-the-golden-copy",
    api_url="https://api.gleif.org/api/v1/",
    description="Global register of legal entities with a stable 20-char identifier (Level 1) plus direct/ultimate parent ownership relationships (Level 2, 'who owns whom').",
    data_type="legal entities, registered addresses, ownership relationships",
    relevance="Gold entity keys and gold corporate ownership edges.",
    granularity="legal entity / relationship record",
    temporal_coverage="2012-present, with registration and last-update timestamps",
    geographic_coverage="global (includes Indian LEIs via LEIL)",
    access_method="bulk Golden Copy + delta files + REST API",
    authentication_required="NO", rate_limit="API fair-use; bulk files preferred",
    robots_or_access_policy="published download endpoints, no crawling needed",
    license="CC0 1.0", license_url="https://www.gleif.org/en/meta/lei-data-terms-of-use",
    training_use="YES", redistribution="YES", attribution_required="NO",
    third_party_content="self-reported by registrants",
    pii_risk="LOW (legal entities, not natural persons)", copyright_risk="LOW",
    provenance_quality="HIGH (LOU-attributed, validated, timestamped)",
    freshness="daily", collection_complexity="LOW",
    quality_score=9, legal_score=10, privacy_score=10, overall_score=9,
    task_er=3, task_ner=1, task_re=3, task_ee=0, task_tmp=2, task_geo=2,
    task_con=1, task_gra=3, task_rpt=1,
    tier="A", status="APPROVED",
    notes="Not in the original brief and it should have been. A globally unique validated entity key is exactly what an entity-resolution evaluation needs, and Level 2 gives real ownership edges under CC0. GLEIF disclaims accuracy - data is registrant-supplied - so treat conflicts as a contradiction-detection signal, not as error.",
)

add(
    source_id="SRC-003", source_name="DocRED / Re-DocRED",
    publisher="THUNLP (Tsinghua University)",
    source_type="academic labelled dataset",
    official_url="https://github.com/thunlp/DocRED",
    dataset_url="https://github.com/thunlp/DocRED",
    api_url="",
    description="Document-level relation extraction over Wikipedia text linked to Wikidata: human-annotated entities, 96 relation types, and supporting evidence sentences, plus a large distantly-supervised split.",
    data_type="documents with entity mentions, relations, evidence sentence IDs",
    relevance="Direct supervision for cross-sentence relationship extraction with evidence.",
    granularity="document / entity pair / evidence sentence",
    temporal_coverage="Wikipedia snapshot", geographic_coverage="global (English)",
    access_method="direct download", authentication_required="NO", rate_limit="n/a",
    robots_or_access_policy="n/a",
    license="MIT", license_url="https://github.com/thunlp/DocRED/blob/master/LICENSE",
    training_use="YES", redistribution="YES", attribution_required="YES (MIT notice)",
    third_party_content="underlying text is Wikipedia (CC BY-SA) - see notes",
    pii_risk="LOW", copyright_risk="MEDIUM",
    provenance_quality="HIGH (evidence sentences per relation)",
    freshness="static (2019)", collection_complexity="LOW",
    quality_score=9, legal_score=8, privacy_score=9, overall_score=9,
    task_er=1, task_ner=3, task_re=3, task_ee=1, task_tmp=1, task_geo=1,
    task_con=1, task_gra=2, task_rpt=2,
    tier="A", status="APPROVED_WITH_RESTRICTIONS",
    manual_review_required="YES",
    notes="Closest public analogue to NetIntel's own relationship-extraction task, and it comes with evidence spans, which is what a provenance-first system needs. MANUAL_REVIEW on one point: the repo is MIT but the source text is Wikipedia, so redistribution of the text may carry CC BY-SA obligations the MIT file does not mention. Prefer Re-DocRED (revised, fewer false negatives) for evaluation.",
)

add(
    source_id="SRC-004", source_name="FEVER",
    publisher="University of Sheffield / Amazon Science",
    source_type="academic labelled dataset",
    official_url="https://fever.ai/dataset/fever.html",
    dataset_url="https://fever.ai/dataset/fever.html", api_url="",
    description="185k claims labelled SUPPORTS / REFUTES / NOT ENOUGH INFO, each with evidence sets identifying the exact Wikipedia page and sentence IDs.",
    data_type="claims, verdict labels, sentence-level evidence pointers",
    relevance="Direct supervision for contradiction detection and evidence-grounded reporting.",
    granularity="claim / evidence sentence", temporal_coverage="Wikipedia 2017 dump",
    geographic_coverage="global (English)", access_method="direct download",
    authentication_required="NO", rate_limit="n/a", robots_or_access_policy="n/a",
    license="CC BY-SA 3.0 (subject to Wikipedia Copyright Policy)",
    license_url="https://fever.ai/download/fever/license.html",
    training_use="YES", redistribution="YES (ShareAlike)", attribution_required="YES",
    third_party_content="Wikipedia text", pii_risk="LOW", copyright_risk="MEDIUM",
    provenance_quality="HIGH (page + sentence ID per evidence item)",
    freshness="static (2018)", collection_complexity="LOW",
    quality_score=9, legal_score=6, privacy_score=9, overall_score=8,
    task_er=0, task_ner=1, task_re=1, task_ee=0, task_tmp=0, task_geo=0,
    task_con=3, task_gra=0, task_rpt=3,
    tier="A", status="APPROVED_WITH_RESTRICTIONS",
    manual_review_required="YES",
    notes="The REFUTES class is real contradiction supervision, and the evidence tuples are exactly the (document, sentence) provenance shape NetIntel already uses. RESTRICTION: CC BY-SA 3.0 is copyleft. Any derived dataset you publish inherits ShareAlike. Keep FEVER-derived records in a separately licensed partition so the obligation cannot leak into the rest of the corpus.",
)

add(
    source_id="SRC-005", source_name="Naamapadam (AI4Bharat)",
    publisher="AI4Bharat / IIT Madras",
    source_type="academic labelled dataset",
    official_url="https://huggingface.co/datasets/ai4bharat/naamapadam",
    dataset_url="https://huggingface.co/datasets/ai4bharat/naamapadam", api_url="",
    description="Largest NER corpus for 11 Indic languages (~5.7M rows), CoNLL-style PER/ORG/LOC tags, produced by projecting English NER labels across the Samanantar parallel corpus; manually labelled test sets for 8 languages.",
    data_type="token-level NER annotations",
    relevance="Only credible route to Hindi/Indic entity extraction supervision.",
    granularity="sentence / token", temporal_coverage="static",
    geographic_coverage="India (11 languages)", access_method="direct download",
    authentication_required="NO", rate_limit="n/a", robots_or_access_policy="n/a",
    license="CC0 1.0",
    license_url="https://huggingface.co/datasets/ai4bharat/naamapadam",
    training_use="YES", redistribution="YES", attribution_required="NO",
    third_party_content="curators state they do not own the underlying text",
    pii_risk="LOW-MEDIUM", copyright_risk="LOW",
    provenance_quality="MEDIUM (projected labels, not gold)",
    freshness="static (2023)", collection_complexity="LOW",
    quality_score=7, legal_score=10, privacy_score=8, overall_score=8,
    task_er=0, task_ner=3, task_re=0, task_ee=0, task_tmp=0, task_geo=1,
    task_con=0, task_gra=1, task_rpt=0,
    tier="A", status="APPROVED",
    notes="India relevance AND task fit in the same source, which almost nothing else on the list achieves. Caveat that matters for evaluation honesty: training labels are alignment-projected and therefore noisy. Report Indic NER numbers only on the manually labelled test splits.",
)

add(
    source_id="SRC-006", source_name="SEC EDGAR (full-text filings + submissions API)",
    publisher="U.S. Securities and Exchange Commission",
    source_type="government filing repository",
    official_url="https://www.sec.gov/edgar",
    dataset_url="https://www.sec.gov/Archives/edgar/full-index/",
    api_url="https://data.sec.gov/",
    description="Complete corpus of US securities filings: real long-form documents with named officers, beneficial owners, subsidiaries, transaction dates and dollar amounts (Forms 3/4/5, 13D/G, 10-K Ex-21, 8-K).",
    data_type="documents, entities, ownership relationships, dated transactions",
    relevance="The only Tier-A source that supplies real investigative-shaped DOCUMENTS with clean licensing.",
    granularity="filing / document / structured exhibit",
    temporal_coverage="1993-present", geographic_coverage="US-registered entities (global subsidiaries)",
    access_method="bulk index + REST API + full-text search",
    authentication_required="NO",
    rate_limit="10 requests/second, enforced",
    robots_or_access_policy="Declared User-Agent with contact email required; fair-access monitoring",
    license="US Government work / public domain (EDGAR filing content free to access and reuse)",
    license_url="https://www.sec.gov/os/webmaster-faq",
    training_use="YES", redistribution="YES", attribution_required="NO",
    third_party_content="filer-authored documents; minimal licensed media",
    pii_risk="MEDIUM (named officers, signatures, addresses in some forms)",
    copyright_risk="LOW", provenance_quality="HIGH (accession number, filer CIK, filing timestamp)",
    freshness="intraday", collection_complexity="MEDIUM",
    quality_score=9, legal_score=9, privacy_score=6, overall_score=9,
    task_er=2, task_ner=3, task_re=3, task_ee=2, task_tmp=3, task_geo=2,
    task_con=2, task_gra=3, task_rpt=3,
    tier="A", status="APPROVED_WITH_RESTRICTIONS",
    notes="Best available stand-in for 'evidence documents with a real entity graph behind them'. Form 4 gives dated person->company transactions; Ex-21 gives corporate hierarchy; 13D/G gives beneficial ownership. Hard restrictions: 10 req/s and a real User-Agent with contact email, both enforced at the collector layer, not by convention.",
)

# ---------------------------------------------------------------- TIER B ----

add(
    source_id="SRC-007", source_name="Indian High Court Judgments (AWS Open Data)",
    publisher="Dattam Labs (from eCourts)",
    source_type="government-derived document corpus",
    official_url="https://registry.opendata.aws/indian-high-court-judgments/",
    dataset_url="s3://indian-high-court-judgments (ap-south-1, --no-sign-request)",
    api_url="",
    description="Judgments from 25 Indian High Courts sourced from eCourts: PDFs plus raw JSON and structured Parquet metadata, bulk tar files, quarterly refresh.",
    data_type="long-form legal documents + structured metadata",
    relevance="Real Indian investigative-adjacent documents with parties, dates, statutes and courts.",
    granularity="judgment document", temporal_coverage="multi-decade",
    geographic_coverage="India (25 High Courts)",
    access_method="public S3 bucket, no AWS account required",
    authentication_required="NO", rate_limit="S3 standard",
    robots_or_access_policy="published open-data bucket",
    license="CC BY 4.0", license_url="https://registry.opendata.aws/indian-high-court-judgments/",
    training_use="YES", redistribution="YES", attribution_required="YES",
    third_party_content="court-authored judgments",
    pii_risk="HIGH (named accused, victims, witnesses, addresses, and matters involving minors)",
    copyright_risk="LOW",
    provenance_quality="HIGH (court, case number, date, bench)",
    freshness="quarterly", collection_complexity="MEDIUM (PDF extraction, OCR for older scans)",
    quality_score=8, legal_score=8, privacy_score=3, overall_score=6,
    task_er=2, task_ner=3, task_re=2, task_ee=2, task_tmp=3, task_geo=2,
    task_con=2, task_gra=2, task_rpt=3,
    tier="B", status="APPROVED_WITH_RESTRICTIONS",
    manual_review_required="YES",
    notes="Strongest India-relevant document source and absent from the original brief. But the privacy score, not the task score, governs here: these are real criminal matters naming real people. Publicly available does not mean fair to reprocess into an investigative graph. Mandatory before any use beyond a sample: pseudonymisation policy, exclusion of matters involving minors and sexual offences, and a documented position on India's DPDP Act 2023 publicly-available-data exemption. Treat as REQUIRES_REVIEW until that policy exists in writing.",
)

add(
    source_id="SRC-008", source_name="OpenNyAI InJudgements",
    publisher="OpenNyAI / EkStep", source_type="academic document dataset",
    official_url="https://huggingface.co/datasets/opennyaiorg/InJudgements_dataset",
    dataset_url="https://huggingface.co/datasets/opennyaiorg/InJudgements_dataset",
    api_url="",
    description="~13,000 Indian court judgments (1950-2017, 293MB, Parquet) sampled by citation count across 8 case types and courts, with IndianKanoon URLs.",
    data_type="legal documents + case-type labels",
    relevance="Smaller, cleaner, better-documented entry point than the full eCourts corpus.",
    granularity="judgment", temporal_coverage="1950-2017", geographic_coverage="India",
    access_method="direct download", authentication_required="NO", rate_limit="n/a",
    robots_or_access_policy="n/a",
    license="Apache-2.0", license_url="https://huggingface.co/datasets/opennyaiorg/InJudgements_dataset",
    training_use="YES", redistribution="YES", attribution_required="YES",
    third_party_content="court-authored", pii_risk="HIGH (same as SRC-007)",
    copyright_risk="LOW", provenance_quality="MEDIUM-HIGH",
    freshness="static", collection_complexity="LOW",
    quality_score=7, legal_score=9, privacy_score=3, overall_score=6,
    task_er=1, task_ner=3, task_re=2, task_ee=2, task_tmp=3, task_geo=2,
    task_con=1, task_gra=2, task_rpt=3,
    tier="B", status="APPROVED_WITH_RESTRICTIONS",
    manual_review_required="YES",
    notes="Use this for the pilot instead of SRC-007: same document shape, 293MB not terabytes, explicit Apache-2.0. Same PII policy prerequisite. Also check OpenNyAI's separate Legal-NER dataset (Indian legal entity types: PETITIONER, RESPONDENT, JUDGE, STATUTE, PROVISION, PRECEDENT, DATE) - UNVERIFIED here, license not yet confirmed.",
)

add(
    source_id="SRC-009", source_name="KILT benchmark",
    publisher="Meta AI Research", source_type="academic benchmark suite",
    official_url="https://github.com/facebookresearch/KILT",
    dataset_url="https://github.com/facebookresearch/KILT", api_url="",
    description="Unified benchmark over a single 5.9M-document Wikipedia snapshot covering fact-checking, entity linking, slot filling, open-domain QA and dialogue, with every answer carrying provenance (page ID, paragraph, character offsets).",
    data_type="task inputs + answers + provenance spans",
    relevance="Reference design for evidence-linked generation evaluation.",
    granularity="example / provenance span", temporal_coverage="Wikipedia 2019 snapshot",
    geographic_coverage="global (English)", access_method="direct download",
    authentication_required="NO", rate_limit="n/a", robots_or_access_policy="n/a",
    license="MIT (code); constituent datasets retain their own licenses",
    license_url="https://github.com/facebookresearch/KILT",
    training_use="MANUAL_REVIEW (per constituent dataset)",
    redistribution="MANUAL_REVIEW", attribution_required="YES",
    third_party_content="YES - FEVER, Natural Questions, HotpotQA, TriviaQA, ELI5, AIDA, T-REx, WoW each carry distinct terms",
    pii_risk="LOW", copyright_risk="MEDIUM",
    provenance_quality="HIGH (char-level offsets, BLEU alignment scores)",
    freshness="static (2020)", collection_complexity="MEDIUM (35GB knowledge source)",
    quality_score=8, legal_score=5, privacy_score=9, overall_score=7,
    task_er=1, task_ner=2, task_re=2, task_ee=0, task_tmp=0, task_geo=0,
    task_con=2, task_gra=0, task_rpt=3,
    tier="B", status="MANUAL_REVIEW", manual_review_required="YES",
    notes="The MIT badge covers the KILT tooling, NOT the eight datasets it aggregates. Adopting KILT wholesale would silently import at least four different license regimes. Recommended use: copy the provenance SCHEMA (page + paragraph + char offsets + alignment score) into NetIntel's evidence model, and take individual constituent datasets only after each is separately cleared.",
)

add(
    source_id="SRC-010", source_name="MAVEN-ERE",
    publisher="THU-KEG (Tsinghua University)", source_type="academic labelled dataset",
    official_url="https://github.com/THU-KEG/MAVEN-ERE",
    dataset_url="https://github.com/THU-KEG/MAVEN-ERE", api_url="",
    description="4,480 documents with 103k event coreference chains, 1.22M temporal relations (BEFORE/OVERLAP/CONTAINS/SIMULTANEOUS/BEGINS-ON/ENDS-ON), 57,992 causal and 15,841 subevent relations.",
    data_type="event mentions + inter-event relation labels",
    relevance="By far the richest public supervision for event and temporal reasoning.",
    granularity="event mention / event pair", temporal_coverage="static",
    geographic_coverage="global (English, Wikipedia-derived)",
    access_method="direct download", authentication_required="NO", rate_limit="n/a",
    robots_or_access_policy="n/a",
    license="GPL-3.0", license_url="https://github.com/THU-KEG/MAVEN-ERE",
    training_use="MANUAL_REVIEW", redistribution="MANUAL_REVIEW (copyleft)",
    attribution_required="YES", third_party_content="Wikipedia-derived text",
    pii_risk="LOW", copyright_risk="MEDIUM-HIGH",
    provenance_quality="HIGH", freshness="static (2022)", collection_complexity="LOW",
    quality_score=9, legal_score=4, privacy_score=9, overall_score=6,
    task_er=1, task_ner=2, task_re=2, task_ee=3, task_tmp=3, task_geo=0,
    task_con=2, task_gra=2, task_rpt=1,
    tier="B", status="MANUAL_REVIEW", manual_review_required="YES",
    notes="Highest task-fit score of any event/temporal source and the licensing is the problem, not the data. GPL-3.0 applied to a dataset repository is legally ambiguous: it is a software license, and whether training on GPL data imposes obligations on model weights is unsettled. For a system with a government-deployment story, do not resolve this by assumption. Either obtain written clarification from THU-KEG or use MAVEN-ERE for EVALUATION ONLY and train temporal reasoning on Wikidata qualifiers instead.",
)

add(
    source_id="SRC-011", source_name="GDELT 2.0 (Events / GKG / Mentions)",
    publisher="The GDELT Project", source_type="derived event database",
    official_url="https://www.gdeltproject.org/",
    dataset_url="http://data.gdeltproject.org/gdeltv2/",
    api_url="https://api.gdeltproject.org/api/v2/doc/doc",
    description="Machine-coded global news event stream updated every 15 minutes: CAMEO-coded actor pairs, geolocated event records, themes, tone, and source article URLs.",
    data_type="event records, actor codes, geocoordinates, article URLs",
    relevance="Temporal and spatial signal at scale; weak on entities.",
    granularity="event record", temporal_coverage="1979-present (v2 from 2015)",
    geographic_coverage="global", access_method="15-minute file feed + BigQuery + DOC API",
    authentication_required="NO", rate_limit="API fair-use; raw files unmetered",
    robots_or_access_policy="published file endpoints",
    license="Unlimited and unrestricted use for academic, commercial or governmental purposes; redistribution permitted with citation",
    license_url="https://www.gdeltproject.org/about.html",
    training_use="YES", redistribution="YES", attribution_required="YES (cite GDELT + link)",
    third_party_content="CRITICAL - links to copyrighted news articles it does not redistribute",
    pii_risk="MEDIUM (named persons in coded events)",
    copyright_risk="HIGH if article text is fetched",
    provenance_quality="MEDIUM (source URL retained; extraction is unreviewed machine coding)",
    freshness="15 minutes", collection_complexity="LOW (samples) / HIGH (full history)",
    quality_score=5, legal_score=8, privacy_score=5, overall_score=5,
    task_er=0, task_ner=1, task_re=1, task_ee=2, task_tmp=3, task_geo=3,
    task_con=1, task_gra=1, task_rpt=0,
    tier="B", status="APPROVED_WITH_RESTRICTIONS",
    notes="GDELT's own terms are the most permissive of any source here. The risk is one step downstream: GDELT distributes METADATA plus a URL, not article text. The moment a collector follows those URLs to build a document corpus, GDELT's license stops applying and news-publisher copyright starts. HARD RULE: ingest GDELT columns only; never fetch, store or train on the linked articles. Also note actor resolution is coarse (CAMEO country/org codes), so this scores 0 for entity resolution regardless of volume.",
)

# ---------------------------------------------------------------- TIER C ----

add(
    source_id="SRC-012", source_name="OpenSanctions (DATA)",
    publisher="OpenSanctions / OleoSt", source_type="curated entity dataset",
    official_url="https://www.opensanctions.org/",
    dataset_url="https://www.opensanctions.org/datasets/",
    api_url="https://api.opensanctions.org/",
    description="Consolidated sanctions lists, PEPs and criminal watchlists normalised into the FollowTheMoney model, with cross-source entity deduplication already performed.",
    data_type="persons, companies, relationships, sanction events",
    relevance="Structurally ideal, legally constrained.",
    granularity="entity / relationship", temporal_coverage="current + change history",
    geographic_coverage="global", access_method="bulk download + API",
    authentication_required="NO (bulk) / YES (API tiers)",
    rate_limit="API tier-dependent", robots_or_access_policy="published downloads",
    license="CC BY-NC 4.0", license_url="https://www.opensanctions.org/licensing/",
    training_use="NON-COMMERCIAL ONLY", redistribution="NON-COMMERCIAL ONLY",
    attribution_required="YES",
    third_party_content="aggregates official government sanctions lists",
    pii_risk="HIGH (named individuals with adverse designations)",
    copyright_risk="MEDIUM",
    provenance_quality="HIGH (source dataset attribution per entity)",
    freshness="daily", collection_complexity="LOW",
    quality_score=9, legal_score=3, privacy_score=3, overall_score=5,
    task_er=3, task_ner=2, task_re=3, task_ee=2, task_tmp=2, task_geo=2,
    task_con=2, task_gra=3, task_rpt=1,
    tier="C", status="MANUAL_REVIEW", manual_review_required="YES",
    notes="The exact code-vs-data split the brief warned about, confirmed: the repository README states 'The code within this repository is licensed under the MIT License. For content and data, we adhere to CC 4.0 Attribution-NonCommercial.' NonCommercial is not a formality. If NetIntel AI is ever licensed to an agency, sold, or commercialised in any form, training on this data is a breach and paid Screening/OEM licenses exist precisely for that case. RECOMMENDATION: adopt the FtM schema and the OpenSanctions CODE (MIT) and do not ingest the DATA until the commercial posture of the project is decided in writing.",
)

add(
    source_id="SRC-013", source_name="Open Contracting (OCDS) publishers",
    publisher="Open Contracting Partnership + national publishers",
    source_type="government procurement data",
    official_url="https://www.open-contracting.org/data-standard/",
    dataset_url="https://data.open-contracting.org/", api_url="varies by publisher",
    description="Standardised public procurement releases: tenders, awards, contracts, suppliers, buyers, amounts and dates, from ~50 national/subnational publishers.",
    data_type="organisations, contracts, dated transactions",
    relevance="Real money-flow graph edges between named organisations.",
    granularity="release / contract", temporal_coverage="publisher-dependent",
    geographic_coverage="multi-country (Indian coverage limited)",
    access_method="registry bulk downloads + per-publisher APIs",
    authentication_required="varies", rate_limit="varies",
    robots_or_access_policy="varies by publisher",
    license="VARIES BY PUBLISHER - the standard is open, the data is not uniformly licensed",
    license_url="https://data.open-contracting.org/",
    training_use="MANUAL_REVIEW", redistribution="MANUAL_REVIEW",
    attribution_required="varies", third_party_content="government-authored",
    pii_risk="MEDIUM (sole traders, contact persons)", copyright_risk="MEDIUM",
    provenance_quality="MEDIUM-HIGH", freshness="varies",
    collection_complexity="HIGH (per-publisher integration)",
    quality_score=6, legal_score=4, privacy_score=6, overall_score=5,
    task_er=2, task_ner=1, task_re=2, task_ee=2, task_tmp=2, task_geo=1,
    task_con=1, task_gra=2, task_rpt=1,
    tier="C", status="MANUAL_REVIEW", manual_review_required="YES",
    notes="Common failure mode: treating 'Open Contracting' as one license. It is a SCHEMA, not a license. Each publisher sets its own terms, so this cannot be cleared as a single registry row. If pursued, split into one registry row per publisher. Deferred - the integration cost is high and the task-fit is duplicated by SEC EDGAR at lower cost.",
)

add(
    source_id="SRC-014", source_name="Zenodo / Kaggle / generic repositories",
    publisher="CERN / Google", source_type="dataset aggregator",
    official_url="https://zenodo.org/",
    dataset_url="", api_url="https://zenodo.org/api/",
    description="General-purpose research and community dataset hosts with per-dataset licensing.",
    data_type="heterogeneous", relevance="Search surface, not a source.",
    granularity="varies", temporal_coverage="varies", geographic_coverage="varies",
    access_method="per-dataset", authentication_required="varies (Kaggle: YES)",
    rate_limit="varies", robots_or_access_policy="varies",
    license="PER-DATASET - no platform-level license",
    license_url="https://about.zenodo.org/policies/",
    training_use="MANUAL_REVIEW", redistribution="MANUAL_REVIEW",
    attribution_required="varies", third_party_content="frequently, and often undeclared",
    pii_risk="UNKNOWN", copyright_risk="HIGH (frequent re-uploads of licensed corpora)",
    provenance_quality="LOW-VARIABLE", freshness="varies", collection_complexity="LOW",
    quality_score=3, legal_score=2, privacy_score=3, overall_score=3,
    task_er=0, task_ner=0, task_re=0, task_ee=0, task_tmp=0, task_geo=0,
    task_con=0, task_gra=0, task_rpt=0,
    tier="C", status="MANUAL_REVIEW", manual_review_required="YES",
    notes="Cannot be registered as a source at all - only individual datasets can. Kaggle in particular is full of re-uploaded corpora whose original licenses forbid redistribution (CoNLL-2003 and TACRED both appear there illegitimately). POLICY: no Kaggle or Zenodo dataset enters the pipeline without its own registry row and a primary-source license URL.",
)

# ---------------------------------------------------------------- TIER D ----

add(
    source_id="SRC-015", source_name="NCRB Crime in India via data.gov.in / OGD",
    publisher="National Crime Records Bureau / NIC",
    source_type="government statistical release",
    official_url="https://www.data.gov.in/",
    dataset_url="https://www.data.gov.in/", api_url="https://api.data.gov.in/",
    description="Aggregate crime statistics: counts of registered cases by state, district, year and IPC/SLL head. Tabular counts only.",
    data_type="aggregate statistical counts",
    relevance="NONE for the nine ML tasks. Contextual/demo value only.",
    granularity="state or district / year / crime head",
    temporal_coverage="annual, multi-year, published with 1-2 year lag",
    geographic_coverage="India", access_method="CSV/JSON download + OGD API",
    authentication_required="YES (free API key)", rate_limit="API key quota",
    robots_or_access_policy="published API",
    license="Government Open Data License - India (GODL)",
    license_url="https://www.data.gov.in/Godl",
    training_use="YES (license permits)", redistribution="YES",
    attribution_required="YES (prescribed citation format)",
    third_party_content="NO",
    pii_risk="NONE (aggregate)", copyright_risk="LOW",
    provenance_quality="HIGH", freshness="annual, lagged",
    collection_complexity="LOW",
    quality_score=7, legal_score=9, privacy_score=10, overall_score=3,
    task_er=0, task_ner=0, task_re=0, task_ee=0, task_tmp=1, task_geo=1,
    task_con=0, task_gra=0, task_rpt=0,
    tier="D", status="REJECTED",
    notes="REJECTED FOR TRAINING; retained for demo context only. Named as a priority source in the brief. It cannot serve that role. These are counts, not records: no entity mentions, no relationships, no free text, no documents. Task total 2/27, and both points are incidental. The license is clean and the data is legitimate - it is simply the wrong shape for entity resolution, relation extraction, event extraction, contradiction detection or grounded reporting. Keep it for one honest purpose: district-level base rates on the demo map, clearly labelled as an aggregate statistical layer, never as an ML training input. Note GODL explicitly excludes personal information and RTI Section 8 exempt data, which is consistent with it being aggregate-only.",
)

add(
    source_id="SRC-016", source_name="FBI NIBRS / Crime Data Explorer",
    publisher="Federal Bureau of Investigation, UCR Program",
    source_type="government incident statistics",
    official_url="https://cde.ucr.cjis.gov/",
    dataset_url="https://cde.ucr.cjis.gov/", api_url="https://api.usa.gov/crime/fbi/cde/",
    description="Incident-based crime records with coded offense, victim, offender and property attributes, deliberately de-identified before release.",
    data_type="coded incident records",
    relevance="NONE for the nine ML tasks.",
    granularity="incident", temporal_coverage="1991-present",
    geographic_coverage="United States", access_method="bulk download + API",
    authentication_required="YES (api.data.gov key)", rate_limit="API key quota",
    robots_or_access_policy="published API",
    license="US Government work / public domain",
    license_url="https://www.fbi.gov/how-we-can-help-you/more-fbi-services-and-information/ucr",
    training_use="YES (license permits)", redistribution="YES",
    attribution_required="NO", third_party_content="NO",
    pii_risk="LOW (de-identified by design)", copyright_risk="LOW",
    provenance_quality="HIGH", freshness="annual",
    collection_complexity="MEDIUM",
    quality_score=7, legal_score=9, privacy_score=9, overall_score=3,
    task_er=0, task_ner=0, task_re=0, task_ee=1, task_tmp=1, task_geo=1,
    task_con=0, task_gra=0, task_rpt=0,
    tier="D", status="REJECTED",
    notes="Two independent disqualifiers. (1) Shape: de-identification is the whole point of NIBRS, so there are no names, no relationships and no narrative text - precisely the fields NetIntel's models consume. (2) Domain: US-only offense taxonomies and jurisdictions, which would inject distribution shift into an India-facing system for no compensating gain. Task total 3/27.",
)

add(
    source_id="SRC-017", source_name="CoNLL-2003 English NER",
    publisher="CoNLL / Reuters", source_type="academic labelled dataset",
    official_url="https://www.clips.uantwerpen.be/conll2003/ner/",
    dataset_url="", api_url="",
    description="The canonical English NER benchmark, built over Reuters RCV1 newswire.",
    data_type="token-level NER annotations",
    relevance="High task fit, blocked by licensing.",
    granularity="token", temporal_coverage="1996-1997 newswire",
    geographic_coverage="global (English)",
    access_method="annotations free; underlying Reuters corpus requires a signed agreement",
    authentication_required="YES (Reuters/NIST agreement)", rate_limit="n/a",
    robots_or_access_policy="n/a",
    license="Annotations free for research; Reuters RCV1 text requires separate agreement",
    license_url="https://www.clips.uantwerpen.be/conll2003/ner/",
    training_use="MANUAL_REVIEW", redistribution="NO",
    attribution_required="YES", third_party_content="YES - Reuters newswire",
    pii_risk="LOW", copyright_risk="HIGH",
    provenance_quality="HIGH", freshness="static (2003)", collection_complexity="HIGH",
    quality_score=9, legal_score=2, privacy_score=8, overall_score=4,
    task_er=0, task_ner=3, task_re=0, task_ee=0, task_tmp=0, task_geo=1,
    task_con=0, task_gra=0, task_rpt=0,
    tier="D", status="REJECTED", manual_review_required="YES",
    notes="Included deliberately as a trap marker. Copies circulating on GitHub and Kaggle are redistributed without the Reuters agreement, so using one would put unlicensed third-party text into the training corpus while looking entirely routine. Use Few-NERD or MultiCoNER for English NER instead. Same category: TACRED, ACE 2005, OntoNotes, TimeBank - all LDC-gated. If SICSR holds an LDC membership these move to MANUAL_REVIEW; verify before assuming they are out of reach.",
)

add(
    source_id="SRC-018", source_name="General web scraping / news crawling",
    publisher="n/a", source_type="crawl",
    official_url="", dataset_url="", api_url="",
    description="Undirected crawling of news sites, forums, social media or public directories to assemble an investigative corpus.",
    data_type="unlicensed text",
    relevance="Rejected on governance grounds regardless of task fit.",
    granularity="n/a", temporal_coverage="n/a", geographic_coverage="n/a",
    access_method="crawl", authentication_required="n/a", rate_limit="n/a",
    robots_or_access_policy="robots.txt and ToS routinely prohibit",
    license="NONE", license_url="",
    training_use="NO", redistribution="NO", attribution_required="n/a",
    third_party_content="entirely", pii_risk="HIGH", copyright_risk="HIGH",
    provenance_quality="LOW", freshness="n/a", collection_complexity="n/a",
    quality_score=2, legal_score=0, privacy_score=0, overall_score=0,
    task_er=0, task_ner=0, task_re=0, task_ee=0, task_tmp=0, task_geo=0,
    task_con=0, task_gra=0, task_rpt=0,
    tier="D", status="REJECTED",
    notes="Recorded explicitly so the registry contains a written refusal rather than a silent omission. Prohibited by the project's own governance rules (Section 1.1). No collector in this repository may target an arbitrary URL; collectors bind to registry-approved endpoints only, enforced in code (see collection framework).",
)

add(
    source_id="SRC-019", source_name="Operation DarkNet Delhi (synthetic)",
    publisher="NetIntel AI (internal)", source_type="synthetic ground truth",
    official_url="", dataset_url="internal", api_url="",
    description="Deterministic synthetic investigative case with known entities, relationships, timeline, contradictions and expected Copilot answers.",
    data_type="synthetic entities, relationships, events, documents, gold answers",
    relevance="The only source with complete ground truth for every one of the nine tasks.",
    granularity="full case", temporal_coverage="synthetic",
    geographic_coverage="India (synthetic)", access_method="internal generator",
    authentication_required="NO", rate_limit="n/a", robots_or_access_policy="n/a",
    license="Project-owned", license_url="",
    training_use="EVALUATION ONLY (do not train)", redistribution="project discretion",
    attribution_required="NO", third_party_content="NO",
    pii_risk="NONE (fabricated)", copyright_risk="NONE",
    provenance_quality="PERFECT (generated with provenance)",
    freshness="on demand", collection_complexity="NONE",
    quality_score=10, legal_score=10, privacy_score=10, overall_score=9,
    task_er=3, task_ner=3, task_re=3, task_ee=3, task_tmp=3, task_geo=3,
    task_con=3, task_gra=3, task_rpt=3,
    tier="A", status="APPROVED",
    notes="Listed in the registry on purpose. It scores 27/27 - higher than any public source - because it is the only one with gold labels for every task simultaneously. Retiring or de-emphasising it in favour of real OSINT would remove the project's only complete evaluation harness and replace it with unlabelled text. Keep it strictly on the evaluation side of the boundary: never train on it, or the reported numbers become circular.",
)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(root, "docs", "data-research")
    os.makedirs(out, exist_ok=True)

    with open(os.path.join(out, "source-registry.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, quoting=csv.QUOTE_ALL)
        w.writeheader()
        for row in S:
            w.writerow({k: row.get(k, "") for k in FIELDS})

    lines = []
    lines.append("<!-- GENERATED by scripts/build_source_registry.py - do not edit by hand -->\n")

    lines.append("### Task-fit matrix\n")
    lines.append("Scores 0-3 per task. `ER` entity resolution, `NER` entity extraction, "
                 "`RE` relationship extraction, `EE` event extraction, `TMP` temporal, "
                 "`GEO` spatial, `CON` contradiction, `GRA` graph construction, "
                 "`RPT` grounded reporting. Max 27.\n")
    lines.append("| ID | Source | ER | NER | RE | EE | TMP | GEO | CON | GRA | RPT | **Total** | Tier |")
    lines.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in sorted(S, key=lambda x: (-x["task_total"], x["source_id"])):
        cells = " | ".join(str(r["task_" + t]) for t in TASKS)
        lines.append(f"| {r['source_id']} | {r['source_name']} | {cells} | "
                     f"**{r['task_total']}** | {r['tier']} |")
    lines.append("")

    lines.append("### Licensing and status\n")
    lines.append("| ID | Source | License | Training use | Redistribution | PII risk | Status |")
    lines.append("|---|---|---|---|---|---|---|")
    for r in sorted(S, key=lambda x: x["source_id"]):
        lines.append(f"| {r['source_id']} | {r['source_name']} | {r['license']} | "
                     f"{r['training_use']} | {r['redistribution']} | {r['pii_risk']} | "
                     f"`{r['status']}` |")
    lines.append("")

    lines.append("### Scores\n")
    lines.append("| ID | Source | Quality | Legal | Privacy | Overall | Access | Rate limit |")
    lines.append("|---|---|---|---|---|---|---|---|")
    for r in sorted(S, key=lambda x: (-x["overall_score"], x["source_id"])):
        lines.append(f"| {r['source_id']} | {r['source_name']} | {r['quality_score']} | "
                     f"{r['legal_score']} | {r['privacy_score']} | **{r['overall_score']}** | "
                     f"{r['access_method']} | {r['rate_limit'] or 'n/a'} |")
    lines.append("")

    with open(os.path.join(out, "_generated_tables.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    n_review = sum(1 for r in S if r["manual_review_required"] == "YES")
    print(f"sources={len(S)} manual_review={n_review}")
    for r in sorted(S, key=lambda x: -x["task_total"]):
        print(f'  {r["source_id"]}  {r["task_total"]:>2}/27  {r["tier"]}  {r["status"][:34]:<34} {r["source_name"]}')


if __name__ == "__main__":
    main()
