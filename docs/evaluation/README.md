# Evaluation

## Purpose

This directory will hold the evaluation methodology for CIPHER — how the correctness and quality of each pipeline stage (entity resolution, relationship analysis, corroboration, copilot answers, generated reports, etc.) will be measured against the synthetic ground truth.

## What Will Eventually Live Here

- Evaluation methodology and metrics per feature/stage
- Test scenarios and expected outcomes derived from `evidence/ground-truth/`
- Evaluation scripts and their results
- Criteria distinguishing verified evidence from AI-generated inference in evaluation output

## Current Status

**Empty.** No evaluation methodology has been defined. This repository is currently in the pre-setup / foundation phase.

## What Must NOT Be Prematurely Decided

- Specific evaluation frameworks or libraries tied to an unselected technology stack
- Metrics that presume a specific model or architecture choice
- Pass/fail thresholds before there is an implementation to measure

Evaluation design should follow, not precede, the architecture and implementation decisions made in later phases.
