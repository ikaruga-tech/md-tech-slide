---
title: 'Mermaid Diagram Showcase'
author: 'md-tech-slide Team'
theme: 'corporate'
aspectRatio: '16:9'
paginate: true
---

# Mermaid Diagram Showcase

Mermaid diagrams in Markdown Tech Slide.

########

## Architecture Flowchart

```mermaid
flowchart TD
    MD[Markdown Source] --> Parser[Slide Parser]
    Parser --> Deck[Slide Deck IR]
    Deck --> Webview[Preview Webview]
    Deck --> PPTX[PPTX Export]
    Deck --> PDF[PDF Export]
```

########

## Multi-Column Diagram

::: columns ratio="1:1"
::: column

### Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    Client->>Server: Request
    Server-->>Client: Response
```

:::
::: column

### Description

- Seamless vector rendering
- Native OpenXML vector SVG embedding in PPTX
- Crisp high-resolution rendering in PDF

:::
:::
