// The "Who built this" section of the About page. Write it yourselves, in your own words.
// The section stays hidden until `story` has text in it.
//
// Questions to get you started (you don't have to answer all of them):
//  - What happened that gave you the idea? Be specific: which light, how long you waited, what you thought.
//  - Why does it matter to people in Hillsborough?
//  - What surprised you while building it? (e.g. finding out three different agencies own the lights)
//  - What did each of you work on?
//  - What do you hope happens next?
//
// Privacy: first names only is fine. Think twice before adding your school, grade or photos.

export type TeamMember = { name: string; role: string; bio: string };

export const team: { story: string; members: TeamMember[] } = {
  story: "",
  members: [
    // { name: "Sohum", role: "...", bio: "..." },
    // { name: "Vihaan", role: "...", bio: "..." },
  ],
};
