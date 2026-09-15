import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "social-hub",
  name: "Social Hub",
  eventKey: process.env.INNGEST_EVENT_KEY,
});
