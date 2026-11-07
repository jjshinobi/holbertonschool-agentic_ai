/**
 * Unit tests for src/cart_calculator.js (calculateTotal).
 *
 * Conventions (TESTING_GUIDELINES.md):
 * - Test names follow should_[EXPECTED_BEHAVIOR]_when_[CONDITION].
 * - Each test body is split into // Arrange, // Act and // Assert blocks.
 *
 * "Known quirk" and "Known defect" tests pin the current legacy output on purpose,
 * so that any behavior change made during the migration to cents is explicit and reviewed.
 */

const { calculateTotal } = require('../src/cart_calculator');

describe('calculateTotal', () => {
    describe('invalid or empty cart input', () => {
        it('should_return_zero_when_items_is_empty_array', () => {
            // Arrange
            const items = [];

            // Act
            const result = calculateTotal(items);

            // Assert
            expect(result).toBe(0);
        });

        it('should_return_zero_when_items_is_null', () => {
            // Arrange
            const items = null;

            // Act
            const result = calculateTotal(items);

            // Assert
            expect(result).toBe(0);
        });

        it('should_return_zero_when_items_is_undefined', () => {
            // Arrange
            const items = undefined;

            // Act
            const result = calculateTotal(items);

            // Assert
            expect(result).toBe(0);
        });

        it('should_return_zero_when_items_is_a_plain_object', () => {
            // Arrange
            const items = { price: 10, quantity: 1 };

            // Act
            const result = calculateTotal(items);

            // Assert
            expect(result).toBe(0);
        });

        it('should_return_zero_when_items_is_a_string', () => {
            // Arrange
            const items = 'not a cart';

            // Act
            const result = calculateTotal(items);

            // Assert
            expect(result).toBe(0);
        });

        it('should_ignore_tax_and_discount_when_cart_is_empty', () => {
            // Arrange
            const items = [];
            const taxRate = 0.5;
            const discount = 100;

            // Act
            const result = calculateTotal(items, taxRate, discount);

            // Assert
            expect(result).toBe(0);
        });
    });

    describe('subtotal calculation', () => {
        // Tax rate is set to 0 in these tests so that only the subtotal is verified.

        it('should_return_price_times_quantity_when_single_item_given', () => {
            // Arrange
            const items = [{ price: 10, quantity: 2 }];
            const taxRate = 0;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(20);
        });

        it('should_sum_all_lines_when_multiple_items_given', () => {
            // Arrange
            const items = [
                { price: 10, quantity: 2 },
                { price: 5.5, quantity: 3 },
                { price: 0.99 },
            ];
            const taxRate = 0;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(37.49);
        });

        it('should_default_quantity_to_one_when_quantity_is_missing', () => {
            // Arrange
            const items = [{ price: 15 }];
            const taxRate = 0;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(15);
        });

        // Known quirk: `item.quantity || 1` treats 0 as missing, so a zero quantity is charged as one unit.
        it('should_charge_one_unit_when_quantity_is_zero', () => {
            // Arrange
            const items = [{ price: 15, quantity: 0 }];
            const taxRate = 0;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(15);
        });

        it('should_default_quantity_to_one_when_quantity_is_null', () => {
            // Arrange
            const items = [{ price: 15, quantity: null }];
            const taxRate = 0;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(15);
        });

        it('should_default_quantity_to_one_when_quantity_is_nan', () => {
            // Arrange
            const items = [{ price: 15, quantity: NaN }];
            const taxRate = 0;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(15);
        });

        it('should_contribute_zero_when_quantity_is_negative', () => {
            // Arrange
            const items = [{ price: 10, quantity: -3 }];
            const taxRate = 0;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(0);
        });

        it('should_support_fractional_quantity_when_quantity_is_decimal', () => {
            // Arrange
            const items = [{ price: 10, quantity: 1.5 }];
            const taxRate = 0;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(15);
        });

        // Known quirk: no type validation, so NaN propagates into the total.
        it('should_return_nan_when_quantity_is_non_numeric_string', () => {
            // Arrange
            const items = [{ price: 10, quantity: 'abc' }];
            const taxRate = 0;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBeNaN();
        });

        it('should_contribute_zero_when_price_is_missing', () => {
            // Arrange
            const items = [{ quantity: 2 }];
            const taxRate = 0;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(0);
        });

        it('should_contribute_zero_when_price_is_null', () => {
            // Arrange
            const items = [{ price: null, quantity: 2 }];
            const taxRate = 0;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(0);
        });

        it('should_contribute_zero_when_price_is_zero', () => {
            // Arrange
            const items = [{ price: 0, quantity: 5 }];
            const taxRate = 0;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(0);
        });

        it('should_contribute_zero_when_price_is_negative', () => {
            // Arrange
            const items = [{ price: -10, quantity: 2 }];
            const taxRate = 0;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(0);
        });

        // Known quirk: no type validation; numeric strings are coerced by Math.max.
        it('should_coerce_price_to_number_when_price_is_numeric_string', () => {
            // Arrange
            const items = [{ price: '10', quantity: 2 }];
            const taxRate = 0;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(20);
        });

        // Known quirk: no validation, so NaN propagates into the total.
        it('should_return_nan_when_price_is_non_numeric_string', () => {
            // Arrange
            const items = [{ price: 'abc', quantity: 1 }];
            const taxRate = 0;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBeNaN();
        });

        it('should_not_offset_total_when_one_item_has_negative_price', () => {
            // Arrange
            const items = [
                { price: 10, quantity: 1 },
                { price: -5, quantity: 1 },
            ];
            const taxRate = 0;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(10);
        });

        it('should_ignore_extra_item_fields_when_item_has_additional_properties', () => {
            // Arrange
            const items = [{ sku: 'BK-1', name: 'Book', price: 12, quantity: 2 }];
            const taxRate = 0;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(24);
        });

        // Known quirk: non-object items are silently ignored instead of rejected.
        it('should_contribute_zero_when_item_is_a_primitive_number', () => {
            // Arrange
            const items = [5];
            const taxRate = 0;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(0);
        });

        it('should_throw_type_error_when_item_is_null', () => {
            // Arrange
            const items = [null];

            // Act
            const act = () => calculateTotal(items);

            // Assert
            expect(act).toThrow(TypeError);
        });

        it('should_throw_type_error_when_item_is_undefined', () => {
            // Arrange
            const items = [undefined];

            // Act
            const act = () => calculateTotal(items);

            // Assert
            expect(act).toThrow(TypeError);
        });
    });

    describe('tax rate', () => {
        it('should_apply_20_percent_tax_when_tax_rate_not_provided', () => {
            // Arrange
            const items = [{ price: 100 }];

            // Act
            const result = calculateTotal(items);

            // Assert
            expect(result).toBe(120);
        });

        it('should_apply_default_tax_rate_when_tax_rate_is_undefined', () => {
            // Arrange
            const items = [{ price: 100 }];
            const taxRate = undefined;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(120);
        });

        it('should_apply_custom_tax_rate_when_tax_rate_provided', () => {
            // Arrange
            const items = [{ price: 100 }];
            const taxRate = 0.1;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(110);
        });

        it('should_apply_fractional_tax_rate_when_tax_rate_has_three_decimals', () => {
            // Arrange
            const items = [{ price: 100 }];
            const taxRate = 0.075;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(107.5);
        });

        it('should_return_pre_tax_total_when_tax_rate_is_zero', () => {
            // Arrange
            const items = [{ price: 100 }];
            const taxRate = 0;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(100);
        });

        it('should_double_total_when_tax_rate_is_one', () => {
            // Arrange
            const items = [{ price: 100 }];
            const taxRate = 1;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(200);
        });

        // Known quirk: default parameters only apply to undefined, so null is coerced to 0 in arithmetic.
        it('should_apply_zero_tax_when_tax_rate_is_null', () => {
            // Arrange
            const items = [{ price: 100 }];
            const taxRate = null;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(100);
        });

        // Known quirk: tax rate is not validated, so a negative rate lowers the total.
        it('should_reduce_total_when_tax_rate_is_negative', () => {
            // Arrange
            const items = [{ price: 100 }];
            const taxRate = -0.5;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(50);
        });

        // Known defect, pinned to current output: taxRate is not coerced. `1 + '0.2'` is '10.2',
        // so the subtotal is multiplied by 10.2 instead of 1.2.
        it('should_return_inflated_total_when_tax_rate_is_numeric_string', () => {
            // Arrange
            const items = [{ price: 100 }];
            const taxRate = '0.2';

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(1020);
        });
    });

    describe('discount', () => {
        it('should_subtract_discount_before_tax_when_discount_provided', () => {
            // Arrange
            const items = [{ price: 100 }];
            const taxRate = 0.2;
            const discount = 10;

            // Act
            const result = calculateTotal(items, taxRate, discount);

            // Assert
            expect(result).toBe(108);
        });

        it('should_apply_discount_to_whole_cart_when_multiple_items_given', () => {
            // Arrange
            const items = [
                { price: 50, quantity: 2 },
                { price: 25 },
            ];
            const taxRate = 0.2;
            const discount = 25;

            // Act
            const result = calculateTotal(items, taxRate, discount);

            // Assert
            expect(result).toBe(120);
        });

        it('should_return_zero_when_discount_exceeds_subtotal', () => {
            // Arrange
            const items = [{ price: 10 }];
            const taxRate = 0.2;
            const discount = 50;

            // Act
            const result = calculateTotal(items, taxRate, discount);

            // Assert
            expect(result).toBe(0);
        });

        it('should_return_zero_when_discount_equals_subtotal', () => {
            // Arrange
            const items = [{ price: 10 }];
            const taxRate = 0.2;
            const discount = 10;

            // Act
            const result = calculateTotal(items, taxRate, discount);

            // Assert
            expect(result).toBe(0);
        });

        it('should_return_full_taxed_total_when_discount_is_zero', () => {
            // Arrange
            const items = [{ price: 100 }];
            const taxRate = 0.2;
            const discount = 0;

            // Act
            const result = calculateTotal(items, taxRate, discount);

            // Assert
            expect(result).toBe(120);
        });

        it('should_ignore_discount_when_discount_is_undefined', () => {
            // Arrange
            const items = [{ price: 100 }];
            const taxRate = 0.2;
            const discount = undefined;

            // Act
            const result = calculateTotal(items, taxRate, discount);

            // Assert
            expect(result).toBe(120);
        });

        it('should_treat_discount_as_zero_when_discount_is_null', () => {
            // Arrange
            const items = [{ price: 100 }];
            const taxRate = 0.2;
            const discount = null;

            // Act
            const result = calculateTotal(items, taxRate, discount);

            // Assert
            expect(result).toBe(120);
        });

        // Known quirk: discount sign is not validated, so a negative discount acts as a surcharge.
        it('should_increase_total_when_discount_is_negative', () => {
            // Arrange
            const items = [{ price: 100 }];
            const taxRate = 0;
            const discount = -20;

            // Act
            const result = calculateTotal(items, taxRate, discount);

            // Assert
            expect(result).toBe(120);
        });

        // Known quirk: no validation, so NaN propagates into the total.
        it('should_return_nan_when_discount_is_non_numeric_string', () => {
            // Arrange
            const items = [{ price: 100 }];
            const taxRate = 0.2;
            const discount = 'abc';

            // Act
            const result = calculateTotal(items, taxRate, discount);

            // Assert
            expect(result).toBeNaN();
        });
    });

    describe('rounding', () => {
        it('should_round_half_up_when_third_decimal_is_five', () => {
            // Arrange
            const items = [{ price: 10.125 }];
            const taxRate = 0;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(10.13);
        });

        it('should_round_down_when_third_decimal_is_below_five', () => {
            // Arrange
            const items = [{ price: 10.124 }];
            const taxRate = 0;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(10.12);
        });

        it('should_round_up_when_third_decimal_is_above_five', () => {
            // Arrange
            const items = [{ price: 10.126 }];
            const taxRate = 0;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(10.13);
        });

        it('should_return_exact_cents_when_float_arithmetic_introduces_error', () => {
            // Arrange
            // 0.1 * 3 is 0.30000000000000004 in IEEE 754 floating point.
            const items = [{ price: 0.1, quantity: 3 }];
            const taxRate = 0;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(0.3);
        });

        it('should_round_to_two_decimals_when_tax_produces_fractional_cents', () => {
            // Arrange
            const items = [{ price: 9.99 }];
            const taxRate = 0.2;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(11.99);
        });

        // Known quirk: 1.005 is stored as 1.00499999999999989..., so it rounds down to 1.00 (not 1.01).
        it('should_round_down_when_price_is_1_005_due_to_float_error', () => {
            // Arrange
            const items = [{ price: 1.005 }];
            const taxRate = 0;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(1);
        });
    });

    describe('whole cart behavior', () => {
        it('should_return_expected_total_when_cart_has_discount_and_tax', () => {
            // Arrange
            const items = [
                { price: 19.99, quantity: 2 },
                { price: 5.5, quantity: 1 },
                { price: 0.99, quantity: 3 },
            ];
            const taxRate = 0.2;
            const discount = 5;

            // Act
            const result = calculateTotal(items, taxRate, discount);

            // Assert
            expect(result).toBe(52.14);
        });

        it('should_return_correct_total_when_cart_has_many_items', () => {
            // Arrange
            const items = Array.from({ length: 1000 }, () => ({ price: 1.5, quantity: 2 }));
            const taxRate = 0.2;

            // Act
            const result = calculateTotal(items, taxRate);

            // Assert
            expect(result).toBe(3600);
        });

        it('should_return_number_when_cart_is_valid', () => {
            // Arrange
            const items = [{ price: 10, quantity: 1 }];

            // Act
            const result = calculateTotal(items);

            // Assert
            expect(typeof result).toBe('number');
        });

        it('should_not_mutate_items_when_total_is_calculated', () => {
            // Arrange
            const items = [{ price: 10, quantity: 2 }];
            const snapshot = JSON.parse(JSON.stringify(items));

            // Act
            calculateTotal(items, 0.2, 5);

            // Assert
            expect(items).toEqual(snapshot);
        });
    });
});
