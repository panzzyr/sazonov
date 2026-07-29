---
layout: layouts/article.njk
title: Why this site weighs 14 kB
description: A portfolio can be fast by construction when typography, content, and the build budget make the decisions.
date: 2026-07-29
lang: en
section: posts
slug: why-this-site-weighs-14-kb
permalink: /posts/why-this-site-weighs-14-kb/
translationUrl: /ru/posts/why-this-site-weighs-14-kb/
englishUrl: /posts/why-this-site-weighs-14-kb/
tags: [web, meta]
draft: false
---

This site begins with a constraint: the complete homepage must fit in 14 kB
after compression. That number is small enough to change how the page is
designed, not just how it is optimized at the end.

## One response is the interface

The homepage contains its own CSS and its only graphic mark. It uses system
fonts, has no client-side framework, and makes no blocking external request.
Eleventy turns Markdown and templates into plain HTML before deployment.

This is not a rejection of JavaScript. It is a decision that an index of text
does not need it.

## Typography does the visual work

There are four neutral colors and two system font stacks. Sans serif carries
the content; monospace carries dates, labels, and status. Weight, scale, rules,
and one inverted “stamp” replace decorative color.

The same structure survives dark mode and print. Those states are CSS media
queries, so they add no runtime behavior.

## The budget is executable

`pnpm build` compresses the generated homepage and exits with an error when it
reaches 14,336 bytes. It also checks for stylesheets, scripts, or eager images
that would add a request before first paint.

A performance promise is useful only when a future change can break the build.
The budget turns “keep it small” from a preference into a property of the
repository.
