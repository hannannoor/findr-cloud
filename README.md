# Findr Cloud

A campus lost-and-found platform with cloud-based image analysis, matching and ownership verification.

**Built with:** AWS · Python · HTML/CSS/JavaScript

**Subject results:** CTAI: Distinction  
*Subject grades; individual project marks were not supplied.*

[Watch the demonstration](https://youtu.be/hrbYugO_jg8)

## What it includes

- Website source plus seven Lambda functions and AWS configuration examples.
- Authenticated report management, private image access, multilingual listings and a campus map.
- Proposal, specification, detailed report, architecture and narrated demo.

## Project status

Archived cloud deployment: the old live website is unavailable. The available local dataset contains 381 images; the report describes a historical 398-image training run. Source completeness does not establish exact reproduction of that training run. The website/backend source matches the final submission snapshot.

## Folder guide

| Folder | Contents |
| --- | --- |
| [`src/`](src/) | Original implementation, assets and project configuration |
| [`docs/`](docs/) | Available specifications, proposals, reports, diagrams and project context |

## Run or open

Start with the deployment guides in `src/guides/` and the setup section of the report. The frontend is in `src/findr/`, backend functions in `src/lambda/`, and AWS policies in `src/aws-config/`.

Restore your own AWS services, models and configuration before expecting the app to work. Replace the credential placeholders using your own setup.

## Supporting documents

| File | Format |
| --- | --- |
| [findr-architecture.png](docs/architecture/findr-architecture.png) | PNG |
| [demo.md](docs/demo.md) | MD |
| [findr-narrated-demo-v2.mp4](docs/demo/findr-narrated-demo-v2.mp4) | MP4 |
| [findr-reviewer-guide.md](docs/development-and-review/findr-reviewer-guide.md) | MD |
| [handoff.md](docs/development-and-review/handoff.md) | MD |
| [video-plan.md](docs/development-and-review/video-plan.md) | MD |
| [video-script.md](docs/development-and-review/video-script.md) | MD |
| [project-context.md](docs/project-context.md) | MD |
| [ctai-findr-project-proposal.docx](docs/proposal/ctai-findr-project-proposal.docx) | DOCX |
| [ctai-findr-project-presentation-revision-4.pptx](docs/reports-and-presentations/ctai-findr-project-presentation-revision-4.pptx) | PPTX |
| [ctai-findr-project-report.docx](docs/reports-and-presentations/ctai-findr-project-report.docx) | DOCX |
| [ctai-project-specification.pdf](docs/specifications/ctai-project-specification.pdf) | PDF |

## Notes

API keys and demonstration passwords detected in the portfolio copies use
placeholders. Configure your own services before running integrations. Original
source credits and bundled third-party licences remain with their files.
