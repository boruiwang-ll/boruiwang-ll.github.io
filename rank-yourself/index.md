---
layout: default
title: LL Cool M | Rank Yourself
---

<section id="rank-yourself">
    <div id="rank-inner" style="display: flex; flex-wrap: nowrap; transition: all 0.5s ease; position: relative;">
        <div id="rank-content" style="flex: 1 1 100%; min-width: 0; transition: flex 0.5s ease;">
            <h1>Where Do You Rank?</h1>
            <p>In the near future, our value and capabilities will be inherently linked to our fluency with AI. This living glossary serves as a checklist to help you identify your current tier in the new AI hierarchy.</p>
            <p>Review the metrics below and honestly assess where you stand. The goal isn't just to find yourself—it's to figure out what it takes to level up.</p>
        
            <div class="table-wrapper" style="margin-top: 2.5rem; overflow-x: auto;">
                <table class="rank-chart" style="width: 100%; border-collapse: collapse; text-align: left;">
                    <thead>
                        <tr style="border-bottom: 2px solid var(--text-main);">
                            <th style="padding: 1rem; font-weight: 600;">Rank</th>
                            <th style="padding: 1rem; font-weight: 600;">Est. Pop %</th>
                            <th style="padding: 1rem; font-weight: 600;">Awareness</th>
                            <th style="padding: 1rem; font-weight: 600;">Usage</th>
                            <th style="padding: 1rem; font-weight: 600;">Output / Value</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style="border-bottom: 1px solid var(--border-color);">
                            <td style="padding: 1rem;"><strong>The Serf</strong></td>
                            <td style="padding: 1rem;"><a href="#" class="pop-link" style="color: var(--text-main); text-decoration: underline; text-decoration-style: dotted; cursor: pointer;">84%</a></td>
                            <td style="padding: 1rem;">Knows AI exists (saw it in the news).</td>
                            <td style="padding: 1rem;">Does not use AI. Might resist it.</td>
                            <td style="padding: 1rem;">Manual workflows. Vulnerable to automation.</td>
                        </tr>
                        <tr style="border-bottom: 1px solid var(--border-color);">
                            <td style="padding: 1rem;"><strong>The Freeman</strong></td>
                            <td style="padding: 1rem;"><a href="#" class="pop-link" style="color: var(--text-main); text-decoration: underline; text-decoration-style: dotted; cursor: pointer;">~10%</a></td>
                            <td style="padding: 1rem;">Has an account on ChatGPT or similar.</td>
                            <td style="padding: 1rem;">Drafts emails, asks simple questions.</td>
                            <td style="padding: 1rem;">Slight efficiency bump; core work unchanged.</td>
                        </tr>
                        <tr style="border-bottom: 1px solid var(--border-color);">
                            <td style="padding: 1rem;"><strong>The Knight</strong></td>
                            <td style="padding: 1rem;"><a href="#" class="pop-link" style="color: var(--text-main); text-decoration: underline; text-decoration-style: dotted; cursor: pointer;">~4.5%</a></td>
                            <td style="padding: 1rem;">Knows models, agents, and their limitations (e.g. Claude vs. GPT).</td>
                            <td style="padding: 1rem;">Daily use: brainstorming, doc summaries, basic code.</td>
                            <td style="padding: 1rem;">Does the work of 1.5 to 2 traditional workers.</td>
                        </tr>
                        <tr style="border-bottom: 1px solid var(--border-color);">
                            <td style="padding: 1rem;"><strong>The Baron</strong></td>
                            <td style="padding: 1rem;"><a href="#" class="pop-link" style="color: var(--text-main); text-decoration: underline; text-decoration-style: dotted; cursor: pointer;">~1%</a></td>
                            <td style="padding: 1rem;">Understands prompt engineering &amp; context loading. Follows AI trends like OpenClaw.</td>
                            <td style="padding: 1rem;">Regular agent use.</td>
                            <td style="padding: 1rem;">Executes multi-disciplinary tasks (e.g. coding + UI).</td>
                        </tr>
                        <tr style="border-bottom: 1px solid var(--border-color);">
                            <td style="padding: 1rem;"><strong>The Earl</strong></td>
                            <td style="padding: 1rem;"><a href="#" class="pop-link" style="color: var(--text-main); text-decoration: underline; text-decoration-style: dotted; cursor: pointer;">~0.4%</a></td>
                            <td style="padding: 1rem;">Fluent in most AI usages.</td>
                            <td style="padding: 1rem;">Builds automation tools chaining multiple models/agents.</td>
                            <td style="padding: 1rem;">Operates at the level of a small, well-equipped team.</td>
                        </tr>
                        <tr style="border-bottom: 1px solid var(--border-color); background-color: rgba(0, 0, 0, 0.03);">
                            <td style="padding: 1rem;"><strong>The Duke</strong></td>
                            <td style="padding: 1rem;"><a href="#" class="pop-link" style="color: var(--text-main); text-decoration: underline; text-decoration-style: dotted; cursor: pointer;">~0.01%</a></td>
                            <td style="padding: 1rem;">Deeply understands AI architectures.</td>
                            <td style="padding: 1rem;">Deploys highly available AI native systems/agents.</td>
                            <td style="padding: 1rem;">Architect level. Creates 10x-100x productivity gains.</td>
                        </tr>
                        <tr>
                            <td style="padding: 1rem;"><strong>The Monarch</strong></td>
                            <td style="padding: 1rem;"><a href="#" class="pop-link" style="color: var(--text-main); text-decoration: underline; text-decoration-style: dotted; cursor: pointer;">~0.0001%</a></td>
                            <td style="padding: 1rem;">Masters the frontier of AI research and science.</td>
                            <td style="padding: 1rem;">Creates foundational models & directs the ecosystem.</td>
                            <td style="padding: 1rem;">Shapes the future of human-AI integration.</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <div id="globe-container-wrap">
            <div style="position: relative; width: 350px; height: 350px; margin: auto;">
                <button id="close-globe">X</button>
                <div id="globe-viz" style="width: 100%; height: 100%; border-radius: 50%; overflow: hidden; transform: rotateZ(23.5deg);"></div>
            </div>
        </div>
    </div>

    <link rel="stylesheet" href="/css/globe.css">
    <script src="https://unpkg.com/globe.gl"></script>
    <script src="/js/globe-controller.js"></script>
</section>
