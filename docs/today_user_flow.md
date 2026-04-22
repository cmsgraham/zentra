# Zentra `/today` User Flow

Navigation map of the Today screen. Corrected to remove dead ends, meaningless loops,
and invalid semantic transitions; all non-terminal states now have forward + recovery paths.

```mermaid
flowchart TD
    Start([User opens /today]) --> Loading[Loading spinner]

    Loading -->|Fetch OK: no priority| Empty[Empty State<br/>EmptyPriorityPrompt]
    Loading -->|Fetch OK: priority + no session| Primed[Primed State<br/>Priority + StartButton]
    Loading -->|Fetch OK: active session| Focused[Focused State<br/>FocusSession]
    Loading -->|Fetch OK: priority done| Complete[Complete State<br/>CompleteDayView]
    Loading -->|Fetch failed| Error[Error State<br/>retry / fallback]

    Error -->|Retry| Loading
    Error -->|Close the day| Planner[/planner/]

    Empty -->|Type new task + Set as priority| Primed
    Empty -->|Pick existing open task| Primed
    Empty -->|AI suggest| Suggested[SuggestedPriority<br/>AI-proposed task]
    Empty -->|No workspace| Workspaces[/workspaces/]
    Workspaces -->|Workspace selected / created| Loading

    Suggested -->|Accept| Primed
    Suggested -->|Reject / try again| Empty

    Primed -->|Next action unclear| NextActionInput[NextActionInput<br/>type or AI clarify]
    Primed -->|Click Start 25 min| Focused
    Primed -->|Change priority| Empty

    NextActionInput -->|Save valid| Primed
    NextActionInput -->|Still unclear| NextActionInput
    NextActionInput -->|Cancel / Close| Primed

    Focused -->|Timer running: Done| Complete
    Focused -->|Timer expired: Mark done| Complete
    Focused -->|Timer expired: +15/+25 min| ExtendCheck{Extensions<br/>under limit?}
    Focused -->|I'm stuck| Stuck[StuckPrompt modal]
    Focused -->|Move on| MoveOn[MoveOnPrompt modal]

    ExtendCheck -->|Yes| Focused
    ExtendCheck -->|Limit reached| Checkpoint[Checkpoint<br/>pause and reassess]
    Checkpoint -->|Continue once more| Focused
    Checkpoint -->|Move on| MoveOn
    Checkpoint -->|Adjust next action| NextActionInput
    Checkpoint -->|Reflect on today| Reflect[/reflect/]

    Stuck -->|Break it into smaller steps<br/>AI decompose| Focused
    Stuck -->|Take a short break| Focused
    Stuck -->|I found a way to start| Focused
    Stuck -->|Work on something else| MoveOn
    Stuck -->|End this session| MoveOn
    Stuck -->|Close / dismiss| Focused
    Stuck -->|Repeated N times| StuckLimit[StuckLimit nudge<br/>change task or priority?]
    StuckLimit -->|Change task| MoveOn
    StuckLimit -->|Change priority| Empty
    StuckLimit -->|Push through| Focused

    MoveOn -->|Keep going / dismiss| Focused
    MoveOn -->|Skip, just end it| Primed
    MoveOn -->|Move on + reason| AfterMoveOn{Another task<br/>available?}
    AfterMoveOn -->|Yes| NextUp[CompactNextUp<br/>5-min rest + next task]
    AfterMoveOn -->|No| Complete

    NextUp -->|Start next| Focused
    NextUp -->|Reflect on today| Reflect
    NextUp -->|See my plan| PlannerWorking[/planner/working/]
    PlannerWorking -->|Back| NextUp
    PlannerWorking -->|Resume work| Focused

    Complete -->|Add another intention| Empty
    Complete -->|Reflect on today| Reflect
    Complete -->|Close the day| Planner
    Planner -->|Start a new session| Start

    classDef state fill:#4a5a9a,stroke:#191f4a,color:#fff
    classDef modal fill:#e17055,stroke:#b84a30,color:#fff
    classDef route fill:#00b894,stroke:#007e63,color:#fff
    classDef decision fill:#fdcb6e,stroke:#c79a3d,color:#2d2a26
    classDef terminal fill:#2d3436,stroke:#000,color:#fff
    classDef error fill:#d63031,stroke:#7a1414,color:#fff
    class Empty,Primed,Focused,Complete,NextUp,Suggested,Checkpoint,StuckLimit state
    class Stuck,MoveOn,NextActionInput modal
    class Planner,PlannerWorking,Workspaces route
    class AfterMoveOn,ExtendCheck decision
    class Reflect terminal
    class Error error
```

## Legend

- **Blue** — core view states of `/today`
- **Orange** — modals / inline prompts (all have a Cancel/Close back-edge)
- **Green** — external routes (user leaves `/today` but can return)
- **Yellow** — conditional branches
- **Dark** — terminal state (`/reflect` — end of day, no exits by design)
- **Red** — error state with retry + fallback

## Corrections applied

| # | Issue | Fix |
|---|---|---|
| 1 | `Workspaces` dead end | `Workspaces → Loading` after selection |
| 2 | `PlannerWorking` dead end | `PlannerWorking → NextUp` / `→ Focused` |
| 3 | `Planner` dead end | optional `Planner → Start` re-entry |
| 4 | `Reflect` | kept terminal (intentional) |
| 5 | `AfterMoveOn: No → Empty` wrong | now `→ Complete` |
| 6 | AI suggest soft loop | new `SuggestedPriority` state with Accept/Reject |
| 7 | NextActionInput validation | split `Save valid` vs `Still unclear` + Cancel |
| 8 | Modal cancels missing | Stuck/MoveOn/NextActionInput all have close edges |
| 9 | Timer extension infinite | `ExtendCheck` gate → `Checkpoint` after N |
| 10 | Stuck infinite loop | `StuckLimit` after N repetitions |
| 11 | MoveOn "Keep going" | treated as dismiss → `Focused` |
| 12 | Loading failure unhandled | new `Error` state with Retry / Close the day |

## Key endpoints

- `GET/POST /focus/sessions/active`
- `POST /focus/sessions/{id}/complete`
- `POST /focus/sessions/{id}/abandon`
- `POST /focus/sessions/{id}/extend`
- `POST /ai/clarify`, `POST /ai/decompose`, `POST /priority/suggest`
- `PATCH /tasks/{id}/next-action`
