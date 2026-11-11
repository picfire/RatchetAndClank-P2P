# Browser Mission Catalog

This inventory is extracted from the supported USA game data, not inferred from
planet descriptions. The per-level pointer table `mission_lists_by_level` at
`0x001A2B70` contains menu records whose IDs match `HelpMessageEntry.message_id`
in the USA-English help-text archive. The table is consumed by
[`update_mission_list`](../../src/game/missions/update_mission_list.c); text IDs
are looked up by the game's help-text system. In the inspected USA ISO the
`help_text` archive is at sector 18179 and spans 308 sectors.

There are 68 non-terminator menu records and 67 distinct labels. Rilgar has two
gate records for the same `Win the hoverboard race` label (`0x5344`); it is listed
once below. Formatting bytes used to highlight item names in game text were
removed for readability. IDs retain the link to the original localized text.

**Important:** these are mission-menu labels, not fully recovered mission
implementations. The per-world mission prerequisites are partly represented by
menu conditions, but the runtime `mission_id_collection_node_source` at
`0x001A2C20` is null in the extracted base executable. Objective chains, actor
bindings, and exact completion events still need to be traced from loaded level
data and source. No mission below is implemented in the browser; Veldin currently
has only its scene/control slice.

For each entry, the next task is to find its runtime mission node and relevant
level actors, record its prerequisite/completion conditions, then implement and
regression-test that mission. Do not mark the label itself as playable progress.

## Level 00: Veldin Tutorial

- [ ] `0x53B2` Investigate crash site - scene/control slice exists; objective not implemented.

## Level 01: Novalis

- [ ] `0x5320` Find a new ship
- [ ] `0x5321` Explore the waterworks
- [ ] `0x5322` Buy Infobot from mechanic

## Level 02: Aridia

- [ ] `0x5329` Locate Skid McMarx
- [ ] `0x532A` Help Skid get to his ship
- [ ] `0x532B` Find Skid's agent
- [ ] `0x532C` Bring prize to agent
- [ ] `0x532D` Use your Swingshot

## Level 03: Kerwan

- [ ] `0x5336` Visit Al's Roboshack
- [ ] `0x5337` Buy Heli-Pack from Al
- [ ] `0x5338` Explore the rest of the city
- [ ] `0x5339` Ride the Robot Train
- [ ] `0x533A` Complete fitness course
- [ ] `0x533B` Buy Swingshot from trainer

## Level 04: Eudora

- [ ] `0x533E` Confront robot lieutenant
- [ ] `0x533F` Explore the mills

## Level 05: Rilgar

- [ ] `0x5344` Win the hoverboard race (two gate records share this label)
- [ ] `0x5345` Locate Captain Qwark
- [ ] `0x5346` Bribe the bodyguard

## Level 06: Nebula G34

- [ ] `0x534D` Explore the space station
- [ ] `0x534E` Buy Grindboots
- [ ] `0x534F` Explore the Blarg warship
- [ ] `0x5350` Destroy the warship
- [ ] `0x5351` Journey outside the airlock

## Level 07: Umbris

- [ ] `0x5355` Survive Qwark's gauntlet
- [ ] `0x5356` Destroy the Snagglebeast
- [ ] `0x5357` Find a new ship

## Level 08: Batalia

- [ ] `0x535F` Scout the area
- [ ] `0x5360` Ride the grind rail
- [ ] `0x5361` Buy Deserter's Infobot
- [ ] `0x5362` Talk to the Commando
- [ ] `0x5363` Meet the Commando at city
- [ ] `0x5364` Explore the walled city
- [ ] `0x5365` Destroy the bombers

## Level 09: Gaspar

- [ ] `0x5368` Find the Pilot's Helmet

## Level 10: Orxon

- [ ] `0x5370` Search the laboratories
- [ ] `0x5371` Traverse the wilderness
- [ ] `0x5373` Explore as Ratchet
- [ ] `0x5372` Catch the Infobot
- [ ] `0x5374` Buy the Premium Nanotech

## Level 11: Pokitaru

- [ ] `0x537C` Check out the resort
- [ ] `0x537D` Help the resort owner
- [ ] `0x537E` Buy Thrusterpack from Bob
- [ ] `0x537F` Destroy the Blarg ships
- [ ] `0x5380` Navigate the sewers
- [ ] `0x5381` Bring Raritanium to Inventor

## Level 12: Hoven

- [ ] `0x5385` Destroy the Planetbuster
- [ ] `0x5386` Explore the Icy Wastes
- [ ] `0x5387` Buy Hydro-Pack from Ed

## Level 13: Oltanis Orbit

- [ ] `0x538A` Explore base
- [ ] `0x538B` Shoot down Captain Qwark

## Level 14: Oltanis

- [ ] `0x5390` Find survivors of the Blarg attack
- [ ] `0x5391` Buy Infobot from scrap merchant
- [ ] `0x5392` Search the destroyed city
- [ ] `0x5393` Purchase Gadgetron PDA from 'Steve'

## Level 15: Quartu

- [ ] `0x539B` Find out more about the Ultra-Mech
- [ ] `0x539C` Destroy the Ultra-Mechs
- [ ] `0x539E` Explore the coolant system
- [ ] `0x539F` Infiltrate the secure area

## Level 16: Kalebo III

- [ ] `0x53A7` Find new equipment
- [ ] `0x53A8` Get past the Blarg
- [ ] `0x53A9` Win the Hoverboard race
- [ ] `0x53AA` Ride the Grind Rail

## Level 17: Veldin Orbit

- [ ] `0x53AD` Find the coordinates for Drek's laser
- [ ] `0x53AE` Swim through the water tanker

## Level 18: Veldin Finale

- [ ] `0x53B0` Save Ratchet's planet
