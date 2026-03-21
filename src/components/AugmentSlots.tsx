import { useState } from "react";
import type { Augment } from "../lib/data-ingest/types";
import type { AugmentAvailability } from "../lib/mode/augment-availability";
import { AugmentCard } from "./AugmentCard";
import { AugmentPicker } from "./AugmentPicker";

const MAX_AUGMENT_SLOTS = 4;

interface AugmentSlotsProps {
  selectedAugments: Augment[];
  availableAugments: Map<string, Augment>;
  availability?: AugmentAvailability;
  onSelect: (augment: Augment) => void;
  onRemoveLast: () => void;
  onReset: () => void;
}

export function AugmentSlots({
  selectedAugments,
  availableAugments,
  availability,
  onSelect,
  onRemoveLast,
  onReset,
}: AugmentSlotsProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  function handleSelect(augment: Augment) {
    onSelect(augment);
    setPickerOpen(false);
  }

  const nextEmptySlot = selectedAugments.length;
  const canPick = nextEmptySlot < MAX_AUGMENT_SLOTS;
  const isPending = availability?.isAvailable ?? false;
  const selectedNames = new Set(selectedAugments.map((a) => a.name));

  return (
    <div className="augment-slots-container">
      <div className="augment-slots-header">
        <p className="entity-title">Your Augments</p>
        {selectedAugments.length > 0 && (
          <button className="refresh-btn" onClick={onReset}>
            Clear
          </button>
        )}
      </div>
      <div className="augment-slots">
        {Array.from({ length: MAX_AUGMENT_SLOTS }, (_, i) => {
          const augment = selectedAugments[i];
          const isEmpty = !augment;
          const isClickable = isEmpty && i === nextEmptySlot && canPick;
          const isLastFilled = !isEmpty && i === nextEmptySlot - 1;
          const isSlotPending = isPending && availability?.pendingSlot === i;

          if (isEmpty) {
            return (
              <div
                key={i}
                className={`augment-slot augment-slot-empty${isClickable ? " augment-slot-clickable" : ""}${isSlotPending ? " augment-slot-pending" : ""}`}
                role={isClickable ? "button" : undefined}
                tabIndex={isClickable ? 0 : undefined}
                onClick={isClickable ? () => setPickerOpen(true) : undefined}
                onKeyDown={
                  isClickable
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setPickerOpen(true);
                        }
                      }
                    : undefined
                }
              >
                <div className="augment-slot-placeholder">
                  <span className="augment-slot-number">{i + 1}</span>
                  {isSlotPending ? (
                    <span className="augment-slot-available">
                      Augment available
                    </span>
                  ) : (
                    isClickable && (
                      <span className="augment-slot-hint">Tap to choose</span>
                    )
                  )}
                </div>
              </div>
            );
          }

          return (
            <div
              key={i}
              className={`augment-slot${isLastFilled ? " augment-slot-removable" : ""}`}
              onClick={isLastFilled ? onRemoveLast : undefined}
            >
              <AugmentCard augment={augment} />
            </div>
          );
        })}
      </div>

      {pickerOpen && (
        <div className="augment-picker-overlay">
          <div className="augment-picker-overlay-header">
            <p className="entity-title">Choose Augment</p>
            <button
              className="refresh-btn"
              onClick={() => setPickerOpen(false)}
            >
              Cancel
            </button>
          </div>
          <AugmentPicker
            augments={availableAugments}
            excludeNames={selectedNames}
            onSelect={handleSelect}
          />
        </div>
      )}
    </div>
  );
}
