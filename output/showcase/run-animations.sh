#!/bin/zsh
# Runs three animations for one showcase character, in sequence, through the
# same pipeline the tool uses. One process per character so five characters
# run as five parallel streams without tripping the per-process paid guard.
#
#   ./run-animations.sh <slug>
set -u
cd "$(dirname "$0")/../../apps/web" || exit 1
slug="$1"
root="../../output/showcase/$slug"
asset="$root/character.json"

run() {
  local name="$1" motion="$2" effects="$3" frames="${4:-4}"
  mkdir -p "$root/$name"
  local started=$(date +%s)
  SUBJECT="$SUBJECT" FACING="$FACING" EFFECTS="$effects" bun run scripts/animate-bench.ts "$asset" "$motion" "$frames" "$root/$name" > "$root/$name/log.txt" 2>&1
  local code=$?
  echo "exit $code, wall $(( $(date +%s) - started ))s" >> "$root/$name/log.txt"
  echo "$slug/$name: exit $code, wall $(( $(date +%s) - started ))s"
}

case "$slug" in
  knight)
    SUBJECT="stout armoured knight in blue plate with a red plume, longsword in the right hand, kite shield on the left arm"
    FACING="in a three-quarter view facing screen-right"
    run slash "a heavy overhead sword slash" "a white air-cut arc along the blade's path at the moment of the slash"
    run shield-bash "a shield bash: lunging forward and slamming the shield" "a small white impact burst where the shield strikes"
    run victory "a victory pose: raising the sword high overhead and planting the shield" "golden sparkles around the raised blade"
    ;;
  mage)
    SUBJECT="fire mage in a crimson hooded robe holding a gnarled staff topped with an ember crystal"
    FACING="in a three-quarter view facing screen-right"
    run fireball "casting a fireball forward from the staff" "an orange-and-yellow fireball with a flame trail leaving the staff tip"
    run eruption "slamming the staff down to erupt flames from the ground" "orange flames bursting up from the ground in front of the mage"
    run flame-ring "a defensive flame shield: sweeping the staff in a full circle" "a ring of orange fire tracing the staff's circle"
    ;;
  ninja)
    SUBJECT="lean ninja in a black shinobi outfit with a red sash and mask, katana in the right hand"
    FACING="in a three-quarter view facing screen-right"
    run dash-slash "a lightning-fast dash slash with the katana" "blue speed lines behind the ninja and a white air-cut arc from the blade"
    run shuriken "throwing three shuriken in a fan" "three spinning shuriken with thin silver motion trails"
    run backflip "a backflip jump and landing" "a small dust puff on take-off and on landing" 5
    ;;
  archer)
    SUBJECT="slender elf archer in a green hooded cloak with a tall recurve longbow in the left hand and a quiver on the back"
    FACING="in a three-quarter view facing screen-right"
    run loose "drawing the bow fully and loosing an arrow" "a streaking arrow with a thin green magic trail"
    run roll "a quick forward dodge roll" "a small dust cloud along the roll"
    run rain "leaping upward and firing three glowing arrows downward" "three glowing green arrows fanning downward" 5
    ;;
  dragon)
    SUBJECT="small chubby green dragon whelp with an orange belly, little bat wings and a long tail, standing on all fours"
    FACING="in a three-quarter view facing screen-right"
    run fire-breath "breathing a cone of fire" "a cone of orange and yellow fire from the mouth"
    run takeoff "flapping its wings to take off and hover" "small dust swirls under the wings" 5
    run tail-whip "a spinning tail whip" "a purple energy arc following the tail"
    ;;
  *) echo "unknown character $slug"; exit 1 ;;
esac
