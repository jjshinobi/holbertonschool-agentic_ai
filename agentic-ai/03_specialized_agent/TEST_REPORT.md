# **1. Generation and Standardization (Application of the Skill)**

## Generated Test File

- **Name:** `cart_calculator.test.js`
- **Path:** `agentic-ai/03_specialized_agent/tests/cart_calculator.test.js`

## Tests Executed

- **Total:** 54 tests in 1 test suite

## Tests Result

```
 PASS  tests/cart_calculator.test.js
  calculateTotal
    invalid or empty cart input
      ✓ should_return_zero_when_items_is_empty_array
      ✓ should_return_zero_when_items_is_null
      ✓ should_return_zero_when_items_is_undefined
      ✓ should_return_zero_when_items_is_a_plain_object
      ✓ should_return_zero_when_items_is_a_string
      ✓ should_ignore_tax_and_discount_when_cart_is_empty
    subtotal calculation
      ✓ should_return_price_times_quantity_when_single_item_given (1 ms)
      ✓ should_sum_all_lines_when_multiple_items_given
      ✓ should_default_quantity_to_one_when_quantity_is_missing
      ✓ should_charge_one_unit_when_quantity_is_zero
      ✓ should_default_quantity_to_one_when_quantity_is_null
      ✓ should_default_quantity_to_one_when_quantity_is_nan (1 ms)
      ✓ should_contribute_zero_when_quantity_is_negative
      ✓ should_support_fractional_quantity_when_quantity_is_decimal
      ✓ should_return_nan_when_quantity_is_non_numeric_string
      ✓ should_contribute_zero_when_price_is_missing
      ✓ should_contribute_zero_when_price_is_null
      ✓ should_contribute_zero_when_price_is_zero
      ✓ should_contribute_zero_when_price_is_negative
      ✓ should_coerce_price_to_number_when_price_is_numeric_string
      ✓ should_return_nan_when_price_is_non_numeric_string
      ✓ should_not_offset_total_when_one_item_has_negative_price
      ✓ should_ignore_extra_item_fields_when_item_has_additional_properties
      ✓ should_contribute_zero_when_item_is_a_primitive_number
      ✓ should_throw_type_error_when_item_is_null (5 ms)
      ✓ should_throw_type_error_when_item_is_undefined
    tax rate
      ✓ should_apply_20_percent_tax_when_tax_rate_not_provided
      ✓ should_apply_default_tax_rate_when_tax_rate_is_undefined
      ✓ should_apply_custom_tax_rate_when_tax_rate_provided
      ✓ should_apply_fractional_tax_rate_when_tax_rate_has_three_decimals
      ✓ should_return_pre_tax_total_when_tax_rate_is_zero
      ✓ should_double_total_when_tax_rate_is_one
      ✓ should_apply_zero_tax_when_tax_rate_is_null
      ✓ should_reduce_total_when_tax_rate_is_negative
      ✓ should_return_inflated_total_when_tax_rate_is_numeric_string
    discount
      ✓ should_subtract_discount_before_tax_when_discount_provided
      ✓ should_apply_discount_to_whole_cart_when_multiple_items_given
      ✓ should_return_zero_when_discount_exceeds_subtotal
      ✓ should_return_zero_when_discount_equals_subtotal
      ✓ should_return_full_taxed_total_when_discount_is_zero
      ✓ should_ignore_discount_when_discount_is_undefined (1 ms)
      ✓ should_treat_discount_as_zero_when_discount_is_null
      ✓ should_increase_total_when_discount_is_negative
      ✓ should_return_nan_when_discount_is_non_numeric_string
    rounding
      ✓ should_round_half_up_when_third_decimal_is_five
      ✓ should_round_down_when_third_decimal_is_below_five
      ✓ should_round_up_when_third_decimal_is_above_five
      ✓ should_return_exact_cents_when_float_arithmetic_introduces_error
      ✓ should_round_to_two_decimals_when_tax_produces_fractional_cents
      ✓ should_round_down_when_price_is_1_005_due_to_float_error
    whole cart behavior
      ✓ should_return_expected_total_when_cart_has_discount_and_tax
      ✓ should_return_correct_total_when_cart_has_many_items (1 ms)
      ✓ should_return_number_when_cart_is_valid
      ✓ should_not_mutate_items_when_total_is_calculated

Test Suites: 1 passed, 1 total
Tests:       54 passed, 54 total
Snapshots:   0 total
Time:        0.36 s, estimated 1 s
Ran all test suites.
```

## Respect Agent rules

The Agent did not modify anything under `src/`. 
