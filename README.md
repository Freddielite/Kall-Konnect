# kall-konnect-mvp

> **Setup:** This app runs on a plain Express + Postgres backend in
> `server/` (see `server/README.md`) — Supabase has been fully removed.
> Copy `.env.example` to `.env` here for the frontend, and
> `server/.env.example` to `server/.env` for the backend, then:
> ```
> cd server && npm install && npm run migrate && npm start
> # in another terminal:
> npm install && npm run dev
> ```

Generate a mobile app called Relationship Assistant (RA) — a contact-based relationship management tool that helps users stay in touch with their friends, family, and colleagues through regular phone calls. The app should integrate with the user’s existing contact list and calendar to remind them who to call, when, and why. The app’s core focus is on promoting real voice conversations instead of text-based communication. It should feel warm, personal, and human-centered — not corporate or sales-y.”

📱 MAIN FEATURE PROMPTS

You can break this into sections when generating or explaining to a designer:

1. Contact Integration

“Integrate seamlessly with the phone’s native contact list. On setup, the app should allow users to select which contact groups to include (family, friends, colleagues). The app should not duplicate contacts but enhance existing ones with call reminders and notes.”

2. Weekly Call Planner

“Create a dashboard that automatically suggests up to 7 people each week to call — one for each day. The selection can be random, or users can manually prioritize some people to appear more often.”

3. Multi-Platform Call Options

“For each contact, include quick-action buttons for all available call options:

Regular mobile phone call

WhatsApp audio call

WhatsApp video call

Instagram audio call

Facebook Messenger call

Snapchat call
The system should detect available call platforms based on which apps the user has installed.”

4. Conversation Templates

“Provide friendly, AI-generated conversation openers and check-in questions to reduce awkwardness. Examples:

‘Hey [Name], just checking in. How’s work been lately?’

‘I remembered our last talk about [topic]. How did that go?’
This feature should adapt to the relationship type (friend, family, colleague, etc.).”

5. Post-Call Summary Notes

“After each call, prompt the user to jot down 2–3 short notes or bullet points about what they talked about. These notes are saved under that contact’s profile to help remember key moments for next time.”

6. Reminders & Notifications

“Users should receive gentle, encouraging reminders — not nagging alerts. For example:

‘It’s been a while since you heard from Mum. How about a quick call today?’

‘Reconnect moment: maybe give Tunde a ring this evening?’”

7. Relationship Stats Dashboard

“Add a friendly analytics screen showing stats like:

Number of calls made this week/month

Longest call streak

Most contacted people

Missed or pending check-ins
It should look positive and gamified, with soft colors and motivating tone.”

8. Customization

“Allow users to choose frequency (weekly, bi-weekly, monthly), preferred call time, and notification style. Provide a ‘Focus Mode’ to pause reminders during busy periods.”

9. Interface and Experience

“The design should feel calm, warm, and emotionally intelligent. Use rounded icons, minimal clutter, and soft pastel colors (e.g., blues, lavender, warm beige). The tone should be friendly and supportive — think ‘your digital friend nudging you to reconnect,’ not a task manager.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://kall-konnect-mvp.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/22592700-1d86-48f1-a4f4-4820e795020f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
