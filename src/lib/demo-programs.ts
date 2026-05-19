import type { SampleProgram } from "@/lib/compiler-types"

export const samplePrograms: SampleProgram[] = [
  {
    id: "fizzbuzz",
    name: "FizzBuzz",
    description: "Loops, branching, modulo checks, and string conversion.",
    notes:
      "A compact success case that makes the whole pipeline easy to inspect without needing multiple files.",
    demonstrates: [
      "while loops and conditionals",
      "integer arithmetic and modulo",
      "string-returning helper methods",
      "runtime output across multiple branches",
    ],
    files: [
      {
        name: "FizzBuzzDemo.java",
        source: `public class FizzBuzzDemo {
  public FizzBuzzDemo() {}

  public static String label(int n) {
    boolean fizz = n % 3 == 0;
    boolean buzz = n % 5 == 0;

    if (fizz && buzz) {
      return "FizzBuzz";
    }
    if (fizz) {
      return "Fizz";
    }
    if (buzz) {
      return "Buzz";
    }
    return String.valueOf(n);
  }

  public static int test() {
    int i = 1;
    while (i <= 15) {
      System.out.println(FizzBuzzDemo.label(i));
      i = i + 1;
    }
    return 123;
  }
}
`,
      },
    ],
  },
  {
    id: "climb-stairs",
    name: "Climb Stairs",
    description: "A recursive dynamic-programming style example.",
    notes:
      "Useful for showing recursive calls, nested expressions, and how a small algorithm lowers through the pipeline.",
    demonstrates: [
      "recursive control flow",
      "base cases and branching",
      "stack-oriented evaluation",
      "integer return values through nested calls",
    ],
    files: [
      {
        name: "ClimbStairsDemo.java",
        source: `public class ClimbStairsDemo {
  public ClimbStairsDemo() {}

  public static int ways(int n) {
    if (n <= 2) {
      return n;
    }
    return ClimbStairsDemo.ways(n - 1) + ClimbStairsDemo.ways(n - 2);
  }

  public static int test() {
    System.out.println(ClimbStairsDemo.ways(5));
    System.out.println(ClimbStairsDemo.ways(7));
    return 123;
  }
}
`,
      },
    ],
  },
  {
    id: "two-sum",
    name: "Two Sum",
    description: "A multi-file search demo with object construction.",
    notes:
      "This shows the flat multi-file workflow and makes the generated assembly more interesting than a single class.",
    demonstrates: [
      "multi-file compilation",
      "arrays and nested loops",
      "object allocation and field access",
      "method calls across classes",
    ],
    files: [
      {
        name: "TwoSumDemo.java",
        source: `public class TwoSumDemo {
  public TwoSumDemo() {}

  public static int test() {
    int[] values = new int[6];
    IntPair answer = null;

    values[0] = 4;
    values[1] = 1;
    values[2] = 9;
    values[3] = 3;
    values[4] = 7;
    values[5] = 11;

    answer = new TwoSumSolver().solve(values, 10);

    if (answer == null) {
      System.out.println("not found");
    } else {
      System.out.println(answer.render());
    }

    return 123;
  }
}
`,
      },
      {
        name: "TwoSumSolver.java",
        source: `public class TwoSumSolver {
  public TwoSumSolver() {}

  public IntPair solve(int[] values, int target) {
    int i = 0;

    while (i < values.length) {
      int j = i + 1;

      while (j < values.length) {
        if (values[i] + values[j] == target) {
          return new IntPair(i, j);
        }
        j = j + 1;
      }

      i = i + 1;
    }

    return null;
  }
}
`,
      },
      {
        name: "IntPair.java",
        source: `public class IntPair {
  public int first;
  public int second;

  public IntPair(int first, int second) {
    this.first = first;
    this.second = second;
  }

  public String render() {
    return "[" + first + ", " + second + "]";
  }
}
`,
      },
    ],
  },
  {
    id: "polymorphism",
    name: "Shape Dispatch",
    description: "Multiple files, inheritance, overrides, and dynamic dispatch.",
    notes:
      "A strong demo for the hierarchy and resolved/typechecked views because the classes meaningfully relate to each other.",
    demonstrates: [
      "inheritance and overrides",
      "base-class references",
      "dynamic dispatch",
      "class hierarchy inspection",
    ],
    files: [
      {
        name: "ShapeShowcase.java",
        source: `public class ShapeShowcase {
  public ShapeShowcase() {}

  public static int test() {
    Shape first = new Rectangle(3, 4);
    Shape second = new Triangle(10, 5);

    System.out.println(first.name() + ":" + first.area());
    System.out.println(second.name() + ":" + second.area());
    System.out.println(first.area() + second.area());
    return 123;
  }
}
`,
      },
      {
        name: "Shape.java",
        source: `public class Shape {
  public Shape() {}

  public String name() {
    return "shape";
  }

  public int area() {
    return 0;
  }
}
`,
      },
      {
        name: "Rectangle.java",
        source: `public class Rectangle extends Shape {
  public int width;
  public int height;

  public Rectangle(int width, int height) {
    this.width = width;
    this.height = height;
  }

  public String name() {
    return "rectangle";
  }

  public int area() {
    return width * height;
  }
}
`,
      },
      {
        name: "Triangle.java",
        source: `public class Triangle extends Shape {
  public int base;
  public int height;

  public Triangle(int base, int height) {
    this.base = base;
    this.height = height;
  }

  public String name() {
    return "triangle";
  }

  public int area() {
    return (base * height) / 2;
  }
}
`,
      },
    ],
  },
  {
    id: "type-mismatch",
    name: "Type Error",
    description: "An intentional type mismatch to show error reporting.",
    notes:
      "This is a deliberate failure case for the diagnostics panel and the pipeline stop indicator.",
    demonstrates: [
      "type-checker failure reporting",
      "stage-aware pipeline stopping",
      "invalid assignment diagnostics",
    ],
    files: [
      {
        name: "TypeMismatchDemo.java",
        source: `public class TypeMismatchDemo {
  public TypeMismatchDemo() {}

  public static int test() {
    int count = true;
    return count;
  }
}
`,
      },
    ],
  },
  {
    id: "syntax-error",
    name: "Syntax Error",
    description: "An intentional parse failure to show frontend diagnostics.",
    notes:
      "This example breaks early so visitors can see how the pipeline differs when lexing succeeds but parsing does not.",
    demonstrates: [
      "frontend-stage failure handling",
      "parser diagnostics",
      "difference between tokens and AST generation",
    ],
    files: [
      {
        name: "SyntaxErrorDemo.java",
        source: `public class SyntaxErrorDemo {
  public SyntaxErrorDemo() {}

  public static int test( {
    return 123;
  }
}
`,
      },
    ],
  },
]
