---
layout: single
title: "Trivia"
permalink: /trivia/
author_profile: true
# Photo galleries: put image files in /images/trivia/ and list them below, e.g.
#   - image_path: trivia/roll-01.jpg
#     alt: "Pittsburgh at dusk, Portra 400"
# A section's gallery appears automatically once it has at least one photo.
film_gallery: []
climbing_gallery: []
table_tennis_gallery: []
---

A few things I enjoy outside of research.

## 📷 Film photography

I'm a film photography enthusiast.
<!-- Add a line or two: your cameras, favorite film stocks, where you like to shoot. -->

{% if page.film_gallery.size > 0 %}{% include gallery id="film_gallery" %}{% endif %}

## 🧗 Bouldering

I'm a casual boulderer.
<!-- Add your home gym or a favorite problem or trip. -->

{% if page.climbing_gallery.size > 0 %}{% include gallery id="climbing_gallery" %}{% endif %}

## 🏓 Table tennis

I play table tennis.
<!-- Add where you play or how you got into it. -->

{% if page.table_tennis_gallery.size > 0 %}{% include gallery id="table_tennis_gallery" %}{% endif %}
