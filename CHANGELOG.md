# Changelog - sdk-integration-library

## [Unreleased]

## Fixed
- Messages are accepted only from the SDK iframe (`event.source`), not from any window of the same origin: two SDK iframes on one origin (two `sign`, or `upload` + `read`) no longer receive each other's events

## [1.0.8] - 18-08-2026

## Added
- New sdk-upload-v2 (BETA)
- Added support for dev environment (Auco internal use only)

## Changes
- Started tracking changes 